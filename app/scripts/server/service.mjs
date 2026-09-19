import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import { CLIENT_PROTOCOL } from '../../lib/storage/protocol.ts';
import { createAccessController } from './access-controller.mjs';
import {
  accountToken,
  createAccountHttp,
  setAccountCookie,
} from './account-http.mjs';
import { body, send } from './http.mjs';
import { createModelProxy } from './model-proxy.mjs';
import { proxy } from './proxy.mjs';

import { accessInput } from './tls.mjs';

const publicMcp = (path) =>
  /^\/mcp\/[a-zA-Z0-9_-]{1,200}$/.test(path) ||
  /^\/oauth\/(authorize|complete|register|token|revoke)$/.test(path) ||
  path === '/.well-known/oauth-authorization-server' ||
  /^\/\.well-known\/oauth-protected-resource\/mcp\/[a-zA-Z0-9_-]{1,200}$/.test(
    path,
  );
const publicDelivery = (path) =>
  /^\/v1\/(models|chat\/completions|messages|responses)$/.test(path);
// Browser-origin checks happen before translating authenticated traffic to the
// existing loopback application. Public MCP retains its separate bounded gateway.
export function createServerService(store, runtime, options = {}) {
  const accounts = options.accounts;
  if (!accounts) throw new Error('Account storage is required.');
  const accountHttp = createAccountHttp(accounts);
  const modelProxy = createModelProxy(store.gatewayKey);
  const appPort = options.appPort ?? 3000;
  const mcpPort = options.mcpPort ?? 3001;
  const access = createAccessController(store, runtime, options);
  const { status, check, begin, challenges } = access;
  function handler(local, publicHttp = false) {
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
        const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(
          url.hostname,
        );
        const peerIsLoopback = [
          '127.0.0.1',
          '::1',
          '::ffff:127.0.0.1',
        ].includes(req.socket.remoteAddress);
        const accepted = local
          ? publicHttp
            ? !url.username &&
              !url.password &&
              (loopback
                ? peerIsLoopback
                : !!isIP(url.hostname.replace(/^\[|\]$/g, '')))
            : loopback
          : [store.access?.origin, status().pending?.origin].includes(origin) &&
            req.headers['x-forwarded-proto'] === 'https';
        if (!accepted)
          return send(res, 403, { error: '请求地址不属于此服务器。' });
        // The public HTTP website never exposes loopback maintenance or MCP routes.
        if (
          publicHttp &&
          (url.pathname.startsWith('/internal/') ||
            url.pathname === '/healthz' ||
            url.pathname.startsWith('/api/tasks/runner-'))
        )
          return send(res, 404, { error: '接口不存在。' });
        if (local && publicMcp(url.pathname))
          return send(res, 403, {
            code: 'HTTPS_REQUIRED',
            error: 'MCP 仅支持已配置的 HTTPS 地址。',
          });
        if (local && url.pathname === '/healthz' && req.method === 'GET')
          return send(res, options.isReady?.() === false ? 503 : 200, {
            ok: options.isReady?.() !== false,
            schema: 5,
            protocol: CLIENT_PROTOCOL,
          });
        if (options.maintenanceFile && existsSync(options.maintenanceFile)) {
          res.setHeader('Retry-After', '30');
          return send(res, 503, { error: '服务正在升级，请稍后重试。' });
        }
        if (local && url.pathname === '/internal/model') {
          if (!accounts.state().activated)
            return send(res, 503, { error: '服务尚未激活。' });
          return modelProxy(req, res);
        }
        if (url.pathname === '/api/server/probe' && req.method === 'GET') {
          const nonce = url.searchParams.get('nonce');
          return challenges.has(nonce)
            ? send(res, 200, { nonce })
            : send(res, 404, { error: '验证请求已失效。' });
        }
        const userToken = accountToken(req, local);
        const user = accounts.user(userToken);
        if (
          user &&
          url.pathname.startsWith('/api/') &&
          !['GET', 'HEAD'].includes(req.method) &&
          req.headers['x-context-hub-version'] !== CLIENT_PROTOCOL
        )
          return send(res, 426, {
            error: '服务已升级，请先复制未保存内容，再刷新页面。',
          });
        const authenticated =
          user?.role === 'admin' &&
          !user.mustChangePassword &&
          accounts.state().activated;
        if (
          await accountHttp(req, res, {
            url,
            origin,
            local,
            user,
            token: userToken,
          })
        )
          return;
        const staticAsset =
          /^\/_next\/static\/[a-zA-Z0-9_./-]+\.(?:js|css|woff2?|ttf|svg|png|ico)$/.test(
            url.pathname,
          );
        const accountPage =
          ['GET', 'HEAD'].includes(req.method) &&
          (['/login', '/register', '/activate'].includes(url.pathname) ||
            staticAsset);
        if (
          (!accounts.state().activated || user?.mustChangePassword) &&
          !accountPage
        ) {
          if (
            url.pathname.startsWith('/api/') ||
            publicMcp(url.pathname) ||
            publicDelivery(url.pathname)
          )
            return send(res, 403, {
              error: '服务尚未激活，请管理员登录。',
            });
          res.writeHead(302, {
            Location: user ? '/activate' : '/login',
            'Cache-Control': 'no-store',
          });
          return res.end();
        }
        if (url.pathname.startsWith('/api/server/')) {
          const action = url.pathname.slice('/api/server/'.length);
          if (req.method === 'GET' && action === 'status')
            return send(res, 200, {
              enabled: true,
              initialized: accounts.list().length > 0,
              authenticated,
              localSetup: local && !publicHttp,
              ...(authenticated ? status() : {}),
            });
          if (req.method !== 'POST')
            return send(res, 405, { error: '不支持的请求方法。' });
          if (
            req.headers.origin !== origin ||
            req.headers['x-context-hub-server'] !== '1'
          )
            return send(res, 403, {
              error: '请从当前服务器页面操作。',
            });
          if (['setup', 'login'].includes(action))
            return send(res, 403, { error: '请使用账号登录页面。' });
          if (!authenticated)
            return send(res, user ? 403 : 401, {
              error: '仅管理员可以配置服务器。',
            });
          if (user && req.headers['x-context-hub-user'] !== user.id)
            return send(res, 409, { error: '登录账号已变化，请刷新页面。' });
          if (action === 'logout' && user) {
            accounts.logout(userToken);
            setAccountCookie(res, '', local);
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
                  '更换地址后需重新登录并连接 MCP，账号数据仍保存在此服务器，请确认后再继续。',
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
        if ((!local || publicHttp) && publicDelivery(url.pathname)) {
          if (req.headers.origin && req.headers.origin !== origin)
            return send(res, 403, { error: '请求来源无效。' });
          return proxy(req, res, appPort, { management: true, secure: !local });
        }
        if (!user && !accountPage) {
          if (url.pathname.startsWith('/api/'))
            return send(res, 401, { error: '管理员会话已失效，请重新登录。' });
          res.writeHead(302, {
            Location: '/login',
            'Cache-Control': 'no-store',
          });
          return res.end();
        }
        if (
          !['GET', 'HEAD'].includes(req.method) &&
          req.headers.origin !== origin
        )
          return send(res, 403, { error: '请求来源无效。' });
        if (['/server', '/admin'].includes(url.pathname) && !authenticated)
          return send(res, 403, { error: '仅管理员可以访问服务器管理。' });
        if (url.pathname.startsWith('/api/tasks/runner-'))
          return send(res, 403, { error: '执行器接口不接受公网请求。' });
        if (
          user &&
          url.pathname.startsWith('/api/') &&
          req.headers['x-context-hub-user'] !== user.id
        )
          return send(res, 409, { error: '登录账号已变化，请刷新页面。' });
        return proxy(req, res, appPort, {
          management: true,
          secure: !local,
          account: user,
          accountKey: store.gatewayKey,
        });
      } catch (failure) {
        if (!res.headersSent)
          send(res, 400, { error: failure.message || '操作失败。' });
        else res.destroy();
      }
    };
  }
  return { handler, status, check, whenIdle: access.whenIdle };
}
