import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  accessInput,
  configureCaddy,
  probeHttps,
  resolvePublicHost,
} from './tls.mjs';

const publicMcp = (path) =>
  /^\/mcp\/[a-zA-Z0-9_-]{1,200}$/.test(path) ||
  /^\/oauth\/(authorize|complete|register|token|revoke)$/.test(path) ||
  path === '/.well-known/oauth-authorization-server' ||
  /^\/\.well-known\/oauth-protected-resource\/mcp\/[a-zA-Z0-9_-]{1,200}$/.test(
    path,
  );
const publicDelivery = (path) =>
  /^\/v1\/(models|chat\/completions|messages|responses)$/.test(path);
const cookieName = (local) => (local ? 'ch_server_local' : '__Host-ch_server');
function cookie(req, local) {
  return req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${cookieName(local)}=`))
    ?.split('=')[1];
}
function send(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!req.headers['content-type']?.includes('application/json'))
    throw new Error('请发送 JSON。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error('请求内容过长。');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求格式无效。');
  }
}

// Browser-origin checks happen before translating authenticated traffic to the
// existing loopback application. Public MCP retains its separate bounded gateway.
export function proxy(
  req,
  res,
  port,
  { origin, management = false, secure = false } = {},
) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  for (const key of Object.keys(headers)) {
    if (
      key.startsWith('x-forwarded-') ||
      key.startsWith('cf-') ||
      key === 'forwarded' ||
      key === 'x-context-hub-gateway-key' ||
      key === 'x-context-hub-server'
    )
      delete headers[key];
  }
  if (management) {
    if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
  } else if (origin) headers.host = new URL(origin).host;
  if (headers.cookie)
    headers.cookie = headers.cookie
      .split(';')
      .filter((s) => !/^\s*(?:ch_server_local|__Host-ch_server)=/.test(s))
      .join(';');
  const upstream = httpRequest(
    { host: '127.0.0.1', port, path: req.url, method: req.method, headers },
    (reply) => {
      const out = { ...reply.headers };
      if (secure && out['set-cookie'])
        out['set-cookie'] = out['set-cookie'].map((s) =>
          /;\s*Secure(?:;|$)/i.test(s) ? s : `${s}; Secure`,
        );
      res.writeHead(reply.statusCode, out);
      reply.pipe(res);
    },
  );
  upstream.setTimeout(120000, () => upstream.destroy());
  upstream.on('error', () => {
    if (!res.headersSent)
      send(res, 503, { error: '应用正在启动或更新，请稍后重试。' });
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

export function createServerService(store, runtime, options = {}) {
  const appPort = options.appPort ?? 3000;
  const mcpPort = options.mcpPort ?? 3001;
  const publicPort = options.publicPort ?? 4080;
  const caddy =
    options.caddy ?? ((access) => configureCaddy(access, publicPort));
  const resolve = options.resolve ?? resolvePublicHost;
  const probe = options.probe ?? probeHttps;
  let pending = null,
    error = '',
    idle = Promise.resolve();
  const challenges = new Set();
  const attempts = new Map();
  const status = () => ({
    access: store.access,
    pending: pending && {
      mode: pending.mode,
      origin: pending.origin,
      phase: pending.phase,
    },
    error,
  });
  async function apply(next) {
    const previous = store.access;
    const usesCaddy =
      previous?.mode === 'automatic' || next.mode === 'automatic';
    const nonce = randomBytes(32).toString('hex');
    challenges.add(nonce);
    let runtimeChanged = false;
    try {
      await resolve(next.origin);
      pending.phase = '正在配置 HTTPS';
      if (usesCaddy) await caddy([previous, next].filter(Boolean));
      pending.phase = '正在验证证书与服务地址';
      let certificate;
      for (
        let attempt = 0;
        attempt < (options.probeAttempts ?? 12);
        attempt++
      ) {
        try {
          certificate = await probe(next.origin, nonce);
          break;
        } catch (failure) {
          if (attempt === (options.probeAttempts ?? 12) - 1) throw failure;
          await delay(options.retryDelay ?? 3000);
        }
      }
      pending.phase = '正在启用访问地址';
      runtimeChanged = true;
      await runtime.configure(next.origin);
      await store.saveAccess({ ...next, ...certificate });
      // A cleanup failure must not undo a successfully saved and reachable origin.
      if (usesCaddy) {
        try {
          await caddy([next]);
        } catch {
          error = '新地址已启用，但旧代理配置未清理，请检查 Caddy 服务。';
        }
      }
    } catch (failure) {
      error = failure.message || '配置失败，原访问地址已保留。';
      if (runtimeChanged) {
        try {
          await runtime.configure(previous?.origin ?? null);
        } catch {
          error += ' 应用恢复失败，请通过 SSH 检查服务。';
        }
      }
      if (usesCaddy) {
        try {
          await caddy(previous ? [previous] : []);
        } catch {
          error += ' 代理恢复失败，请通过 SSH 检查 Caddy。';
        }
      }
    } finally {
      challenges.delete(nonce);
      pending = null;
    }
  }
  function begin(next) {
    if (pending) throw new Error('正在处理上一次配置，请稍候。');
    if (
      store.access?.origin === next.origin &&
      store.access?.mode === next.mode
    )
      throw new Error('当前地址已启用，可使用“检查连接”更新状态。');
    if (
      store.access?.origin === next.origin &&
      store.access?.mode === 'automatic' &&
      next.mode === 'external'
    )
      throw new Error(
        '同一域名从自动证书迁移至外部代理需要通过 SSH 操作，请先完成代理迁移。',
      );
    error = '';
    pending = { ...next, phase: '正在检查域名' };
    idle = apply(next);
  }
  async function check() {
    if (pending || !store.access) return;
    const current = store.access;
    const nonce = randomBytes(32).toString('hex');
    challenges.add(nonce);
    try {
      const certificate = await probe(current.origin, nonce);
      if (!pending && store.access?.origin === current.origin)
        await store.saveAccess({ ...current, ...certificate });
      error = '';
    } catch {
      error =
        'HTTPS 检查失败，请检查证书续期、网络与反向代理。当前配置未更改。';
    } finally {
      challenges.delete(nonce);
    }
  }
  function handler(local) {
    return async (req, res) => {
      try {
        const host = req.headers.host ?? '';
        if (
          !req.url?.startsWith('/') ||
          req.url.startsWith('//') ||
          req.url.includes('\\')
        )
          return send(res, 400, { error: '请求路径无效。' });
        const url = new URL(req.url, `http://${host}`);
        req.url = url.pathname + url.search;
        const origin = local ? `http://${host}` : `https://${host}`;
        const accepted = local
          ? ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
          : [store.access?.origin, pending?.origin].includes(origin) &&
            req.headers['x-forwarded-proto'] === 'https';
        if (!accepted)
          return send(res, 403, { error: '请求地址不属于此服务器。' });
        if (url.pathname === '/api/server/probe' && req.method === 'GET') {
          const nonce = url.searchParams.get('nonce');
          return challenges.has(nonce)
            ? send(res, 200, { nonce })
            : send(res, 404, { error: '验证请求已失效。' });
        }
        const token = cookie(req, local);
        const authenticated = store.authenticated(token, local);
        if (url.pathname.startsWith('/api/server/')) {
          const action = url.pathname.slice('/api/server/'.length);
          if (req.method === 'GET' && action === 'status')
            return send(res, 200, {
              enabled: true,
              initialized: store.initialized,
              authenticated,
              localSetup: local,
              ...(authenticated ? status() : {}),
            });
          if (req.method !== 'POST')
            return send(res, 405, { error: '不支持的请求方法。' });
          if (
            req.headers.origin !== origin ||
            req.headers['x-context-hub-server'] !== '1'
          )
            return send(res, 403, {
              error: '请从本机配置页或当前 HTTPS 页面操作。',
            });
          if (['setup', 'login'].includes(action)) {
            const key = `${local}:${req.socket.remoteAddress}`;
            const at = Date.now();
            for (const [id, item] of attempts)
              if (item.until < at) attempts.delete(id);
            const limit = attempts.get(key) ?? {
              count: 0,
              until: at + 10 * 60000,
            };
            attempts.set(key, limit);
            if (++limit.count > 10)
              return send(res, 429, {
                error: '尝试次数过多，请十分钟后重试。',
              });
            const input = await body(req);
            if (action === 'setup') {
              if (!local)
                return send(res, 403, {
                  error: '首次设置仅允许通过 SSH 转发的本机入口完成。',
                });
              await store.initialize(input.password);
            }
            const session = await store.login(input.password, local);
            if (!session) return send(res, 401, { error: '密码不正确。' });
            res.setHeader(
              'Set-Cookie',
              `${cookieName(local)}=${session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${local ? '' : '; Secure'}`,
            );
            return send(res, 200, { ok: true });
          }
          if (!authenticated)
            return send(res, 401, { error: '请先登录管理员。' });
          if (action === 'logout') {
            await store.logout(token);
            res.setHeader(
              'Set-Cookie',
              `${cookieName(local)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${local ? '' : '; Secure'}`,
            );
            return send(res, 200, { ok: true });
          }
          if (action === 'configure') {
            const input = await body(req);
            if (input.mode === 'automatic' && input.acceptAcmeTerms !== true)
              return send(res, 400, {
                error: '请先阅读并同意证书服务的订户协议。',
              });
            if (
              store.access &&
              input.confirmOriginChange !== true &&
              store.access.origin !== accessInput(input).origin
            )
              return send(res, 409, {
                error:
                  '更换地址后需重新连接 MCP，且浏览器数据不会自动迁移，请确认后再继续。',
              });
            begin(accessInput(input));
            return send(res, 202, { ok: true });
          }
          if (action === 'check') {
            await check();
            return send(res, 200, status());
          }
          return send(res, 404, { error: '接口不存在。' });
        }
        if (!local && store.access?.origin !== origin)
          return send(res, 503, { error: '此地址仍在验证，尚未启用。' });
        if (!local && publicMcp(url.pathname))
          return proxy(req, res, mcpPort, { origin, secure: true });
        if (!local && publicDelivery(url.pathname)) {
          if (req.headers.origin && req.headers.origin !== origin)
            return send(res, 403, { error: '请求来源无效。' });
          return proxy(req, res, appPort, { management: true, secure: true });
        }
        const staticAsset =
          /^\/_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?|ttf|svg|png|ico)$/.test(
            url.pathname,
          );
        const loginPage =
          ['GET', 'HEAD'].includes(req.method) &&
          (url.pathname === '/server' || staticAsset);
        if (!authenticated && !loginPage) {
          if (url.pathname.startsWith('/api/'))
            return send(res, 401, { error: '管理员会话已失效，请重新登录。' });
          res.writeHead(302, {
            Location: '/server',
            'Cache-Control': 'no-store',
          });
          return res.end();
        }
        if (
          !['GET', 'HEAD'].includes(req.method) &&
          req.headers.origin !== origin
        )
          return send(res, 403, { error: '请求来源无效。' });
        return proxy(req, res, appPort, { management: true, secure: !local });
      } catch (failure) {
        if (!res.headersSent)
          send(res, 400, { error: failure.message || '操作失败。' });
        else res.destroy();
      }
    };
  }
  return { handler, status, check, whenIdle: () => idle };
}
