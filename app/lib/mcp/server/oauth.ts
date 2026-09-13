import { uid } from '../../domain.ts';
import { digest, randomSecret } from '../../imports/server/auth.ts';
import {
  readLimitedBody,
  discardRequestBody,
} from '../../imports/server/share-service.ts';
import { McpError, object } from '../contracts.ts';
import type { OAuthRepository, OAuthRequest } from './oauth-repository.ts';
import { oauthClientName } from '../oauth-clients.ts';

export const OAUTH_SCOPE = 'context:tools';
const baseHeaders = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
function fail(message: string, code = 'invalid_request', status = 400): never {
  throw new McpError(code, message, status);
}
const str = (v: unknown, max = 2048) => {
  if (typeof v !== 'string' || !v || v.length > max)
    return fail('请求参数缺失或过长。');
  return v;
};
export function allowedOAuthRedirect(value: unknown) {
  return oauthClientName(value) !== null;
}
function resource(value: unknown, origin: string) {
  const raw = str(value);
  const url = new URL(raw);
  const match = url.pathname.match(/^\/mcp\/([a-zA-Z0-9_-]{1,200})$/);
  if (
    url.origin !== origin ||
    !match ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    return fail('授权目标与当前 MCP 地址不一致。', 'invalid_target');
  return { url: origin + url.pathname, wid: match[1] };
}
function unique(params: URLSearchParams) {
  for (const key of params.keys())
    if (params.getAll(key).length > 1) fail('请求参数重复。');
  return Object.fromEntries(params);
}
async function form(request: Request) {
  if (
    !request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
  )
    fail('需要表单格式。');
  return unique(new URLSearchParams(await readLimitedBody(request, 16384)));
}
export async function pkce(verifier: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
function page(
  content: string,
  cookie?: string,
  status = 200,
  redirectUri?: string,
) {
  return new Response(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCP 授权 · Context Hub</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#f5f2ec;color:#443e36;margin:0;padding:36px 20px}main{max-width:560px;margin:8vh auto;background:#fffdf8;border:1px solid #ded8ce;border-radius:20px;padding:32px}h1{font-size:24px}code{display:block;overflow-wrap:anywhere;background:#eee9e1;padding:14px;border-radius:8px;user-select:all}button{font:inherit;padding:10px 18px;border:1px solid #b9ada0;border-radius:8px;background:#eee7dc;cursor:pointer;margin:8px 8px 0 0}small{color:#736b62}p{overflow-wrap:anywhere}</style><main>${content}</main></html>`,
    {
      status,
      headers: {
        ...baseHeaders,
        // no-referrer turns a browser form POST's Origin into "null".
        // Preserve same-origin consent checks without leaking cross-origin URLs.
        'Referrer-Policy': 'same-origin',
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${redirectUri && allowedOAuthRedirect(redirectUri) ? ' ' + redirectUri : ''}; frame-ancestors 'none'; base-uri 'none'`,
        ...(cookie ? { 'Set-Cookie': cookie } : {}),
      },
    },
  );
}
export function oauthMetadata(origin: string, wid?: string) {
  return Response.json(
    wid
      ? {
          resource: `${origin}/mcp/${wid}`,
          authorization_servers: [origin],
          scopes_supported: [OAUTH_SCOPE],
          bearer_methods_supported: ['header'],
        }
      : {
          issuer: origin,
          authorization_endpoint: origin + '/oauth/authorize',
          token_endpoint: origin + '/oauth/token',
          registration_endpoint: origin + '/oauth/register',
          revocation_endpoint: origin + '/oauth/revoke',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: [
            'none',
            'client_secret_post',
            'client_secret_basic',
          ],
          revocation_endpoint_auth_methods_supported: [
            'none',
            'client_secret_post',
            'client_secret_basic',
          ],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: [OAUTH_SCOPE],
          authorization_response_iss_parameter_supported: true,
        },
    { headers: baseHeaders },
  );
}
async function authenticate(
  request: Request,
  data: Record<string, string>,
  repo: OAuthRepository,
) {
  let id = data.client_id,
    secret = data.client_secret;
  let method = secret ? 'client_secret_post' : 'none';
  const auth = request.headers.get('authorization');
  if (auth) {
    if (!auth.startsWith('Basic ') || secret)
      fail('客户端认证无效。', 'invalid_client', 401);
    let decoded: string;
    try {
      decoded = atob(auth.slice(6));
    } catch {
      return fail('客户端认证无效。', 'invalid_client', 401);
    }
    const colon = decoded.indexOf(':');
    if (colon < 0) fail('客户端认证无效。', 'invalid_client', 401);
    const basicId = decodeURIComponent(decoded.slice(0, colon));
    if (id && id !== basicId) fail('客户端认证不一致。', 'invalid_client', 401);
    id = basicId;
    secret = decodeURIComponent(decoded.slice(colon + 1));
    method = 'client_secret_basic';
  }
  const client = id ? await repo.client(id) : null;
  if (
    !client ||
    client.method !== method ||
    (client.secret_hash && (await digest(secret ?? '')) !== client.secret_hash)
  )
    return fail('客户端认证无效。', 'invalid_client', 401);
  return client;
}
export async function oauthHandler(
  request: Request,
  action: string,
  repo: OAuthRepository,
) {
  const url = new URL(request.url),
    origin = url.origin;
  try {
    if (url.protocol !== 'https:') fail('OAuth 需要 HTTPS。');
    if (request.method === 'POST' && action === 'register') {
      if (!request.headers.get('content-type')?.includes('application/json'))
        fail('需要 JSON 格式。');
      const b = object(JSON.parse(await readLimitedBody(request, 16384)));
      if (
        !Array.isArray(b.redirect_uris) ||
        !b.redirect_uris.length ||
        b.redirect_uris.length > 5 ||
        !b.redirect_uris.every(allowedOAuthRedirect)
      )
        fail('回调地址不属于已支持的 OAuth 客户端。', 'invalid_redirect_uri');
      const method = b.token_endpoint_auth_method ?? 'client_secret_basic';
      if (
        typeof method !== 'string' ||
        !['none', 'client_secret_post', 'client_secret_basic'].includes(method)
      )
        fail('不支持此客户端认证方式。', 'invalid_client_metadata');
      if (
        b.response_types &&
        (!Array.isArray(b.response_types) ||
          b.response_types.some((v) => v !== 'code'))
      )
        fail('仅支持授权码。', 'invalid_client_metadata');
      if (
        b.grant_types &&
        (!Array.isArray(b.grant_types) ||
          b.grant_types.some(
            (v) => !['authorization_code', 'refresh_token'].includes(String(v)),
          ))
      )
        fail('不支持此授权方式。', 'invalid_client_metadata');
      const id = randomSecret('ch_client_'),
        secret = method === 'none' ? null : randomSecret('ch_client_secret_');
      await repo.register({
        id,
        redirects: JSON.stringify(b.redirect_uris),
        method,
        secret_hash: secret ? await digest(secret) : null,
      });
      return Response.json(
        {
          client_id: id,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          ...(secret
            ? { client_secret: secret, client_secret_expires_at: 0 }
            : {}),
          redirect_uris: b.redirect_uris,
          token_endpoint_auth_method: method,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: OAUTH_SCOPE,
        },
        { status: 201, headers: baseHeaders },
      );
    }
    if (request.method === 'GET' && action === 'authorize') {
      const b = unique(url.searchParams);
      const client = await repo.client(str(b.client_id));
      if (
        !client ||
        !JSON.parse(client.redirects).includes(b.redirect_uri) ||
        !allowedOAuthRedirect(b.redirect_uri)
      )
        fail('客户端或回调地址无效。');
      if (
        b.response_type !== 'code' ||
        b.code_challenge_method !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(b.code_challenge ?? '')
      )
        fail('必须使用授权码和 S256 PKCE。');
      if (b.scope && b.scope !== OAUTH_SCOPE)
        fail('请求了未支持的权限。', 'invalid_scope');
      const target = resource(b.resource, origin),
        state = str(b.state, 2048);
      const id = randomSecret(''),
        browser = randomSecret('');
      const r: OAuthRequest = {
        id,
        client_id: client.id,
        redirect_uri: b.redirect_uri,
        resource: target.url,
        workspace_id: target.wid,
        state,
        challenge: b.code_challenge,
        browser_hash: await digest(browser),
        expires_at: Date.now() + 600000,
        owner_id: null,
        denied: 0,
        code_hash: null,
        consumed: 0,
      };
      await repo.begin(r);
      const clientName = escape(oauthClientName(r.redirect_uri)!);
      return page(
        `<h1>连接 ${clientName}</h1><p>请在本机 Context Hub 中打开目标手账的「连接设置」，将下面的请求码粘贴到「确认 OAuth 授权」，核对后批准。</p><code>${id}</code><p><small>目标手账 ID：${escape(target.wid)}<br>回调地址：${escape(r.redirect_uri)}<br>有效期 10 分钟。只批准你刚刚在 ${clientName} 发起的连接。</small></p><p>批准后回到此页继续。授权包括读取记忆、检索原文、读写 Note 和导入分享链接，有效期 30 天，可随时在手账中吊销。</p><form method="post" action="/oauth/complete"><input type="hidden" name="request_id" value="${id}"><input type="hidden" name="csrf" value="${browser}"><button name="decision" value="continue">完成授权，返回 ${clientName}</button><button name="decision" value="cancel">取消</button></form>`,
        `ch_oauth_browser=${browser}; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
        200,
        r.redirect_uri,
      );
    }
    if (request.method === 'POST' && action === 'complete') {
      if (request.headers.get('origin') !== origin)
        fail('请从授权页面继续。', 'invalid_request', 403);
      const b = await form(request);
      const r = await repo.request(str(b.request_id));
      const cookie = request.headers
        .get('cookie')
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith('ch_oauth_browser='))
        ?.slice(17);
      if (
        !r ||
        !cookie ||
        cookie !== b.csrf ||
        (await digest(cookie)) !== r.browser_hash ||
        r.consumed ||
        r.code_hash
      )
        fail('授权页面已失效，请重新连接。');
      const redirect = new URL(r.redirect_uri);
      redirect.searchParams.set('state', r.state);
      redirect.searchParams.set('iss', origin);
      if (b.decision === 'cancel' || r.denied) {
        await repo.cancel(r.id);
        redirect.searchParams.set('error', 'access_denied');
      } else {
        if (b.decision !== 'continue') fail('无效的授权操作。');
        if (!r.owner_id)
          return page(
            '<h1>还未批准</h1><p>请先在本机手账中批准该请求，然后返回上一页继续。</p>',
            undefined,
            409,
          );
        const code = randomSecret('ch_code_');
        await repo.code(r.id, await digest(code));
        redirect.searchParams.set('code', code);
      }
      return new Response(null, {
        status: 303,
        headers: {
          ...baseHeaders,
          Location: redirect.href,
          'Set-Cookie':
            'ch_oauth_browser=; Path=/oauth; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        },
      });
    }
    if (request.method === 'POST' && ['token', 'revoke'].includes(action)) {
      const b = await form(request),
        client = await authenticate(request, b, repo);
      if (action === 'revoke') {
        await repo.revoke(await digest(str(b.token)), client.id);
        return new Response(null, { headers: baseHeaders });
      }
      const target = resource(b.resource, origin);
      if (b.scope && b.scope !== OAUTH_SCOPE)
        fail('权限不能在续期时扩展。', 'invalid_scope');
      const access = randomSecret('ch_mcp_'),
        refresh = randomSecret('ch_refresh_');
      let expiresIn = 3600;
      if (b.grant_type === 'authorization_code') {
        const r = await repo.codeRequest(await digest(str(b.code)));
        if (
          !r ||
          r.client_id !== client.id ||
          r.redirect_uri !== b.redirect_uri ||
          r.resource !== target.url ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier ?? '') ||
          (await pkce(b.code_verifier)) !== r.challenge
        )
          fail('授权码、PKCE 或目标资源不匹配。', 'invalid_grant');
        await repo.exchange(
          r,
          uid(),
          await digest(access),
          await digest(refresh),
        );
      } else if (b.grant_type === 'refresh_token') {
        const hash = await digest(str(b.refresh_token)),
          grant = await repo.grant(hash);
        if (!grant) {
          await repo.replay(hash, client.id);
          fail('续期凭据已失效。', 'invalid_grant');
        }
        if (
          grant.client_id !== client.id ||
          grant.resource !== target.url ||
          grant.revoked_at ||
          grant.expires_at <= Date.now()
        )
          fail('授权已到期、吊销或目标不匹配。', 'invalid_grant');
        expiresIn = Math.max(
          0,
          Math.min(3600, Math.floor((grant.expires_at - Date.now()) / 1000)),
        );
        if (!expiresIn) fail('授权已到期。', 'invalid_grant');
        await repo.refresh(
          grant.token_id,
          hash,
          await digest(refresh),
          await digest(access),
        );
      } else fail('不支持此授权类型。', 'unsupported_grant_type');
      return Response.json(
        {
          access_token: access,
          token_type: 'Bearer',
          expires_in: expiresIn,
          refresh_token: refresh,
          scope: OAUTH_SCOPE,
          resource: target.url,
        },
        { headers: baseHeaders },
      );
    }
    return Response.json(
      { error: 'invalid_request' },
      { status: 404, headers: baseHeaders },
    );
  } catch (error) {
    const e =
      error instanceof McpError
        ? error
        : new McpError('invalid_request', '请求无效或授权服务暂不可用。');
    return Response.json(
      { error: e.code, error_description: e.message },
      { status: e.status, headers: baseHeaders },
    );
  } finally {
    await discardRequestBody(request);
  }
}
