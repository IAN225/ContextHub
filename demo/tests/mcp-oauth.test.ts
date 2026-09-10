import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { blankWorkspace } from '../lib/domain.ts';
import { digest } from '../lib/imports/server/auth.ts';
import { mcpRepository } from '../lib/mcp/server/repository.ts';
import { oauthRepository } from '../lib/mcp/server/oauth-repository.ts';
import {
  oauthHandler,
  oauthMetadata,
  pkce,
  allowedOAuthRedirect,
} from '../lib/mcp/server/oauth.ts';
import { manageMcp, mcpHandler } from '../lib/mcp/server/handlers.ts';
import { gatewayRequest } from '../lib/mcp/server/public-config.ts';
import {
  oauthClientName,
  resolveOAuthClient,
  oauthClientProfiles,
  type OAuthClientProfile,
} from '../lib/mcp/oauth-clients.ts';
const CLAUDE_OAUTH_CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

const publicOrigin = 'https://oauth-fixture.example';
void test('another OAuth client can be added as configuration without widening existing callbacks', () => {
  const extra: OAuthClientProfile = {
    id: 'example-client',
    name: 'Example Client',
    redirects: [
      { kind: 'exact', uri: 'https://client.example/oauth/callback' },
    ],
    instructions: ['Add the MCP URL in Example Client.'],
  };
  const profiles = [...oauthClientProfiles, extra];
  assert.equal(
    resolveOAuthClient('https://client.example/oauth/callback'),
    null,
  );
  assert.equal(
    resolveOAuthClient('https://client.example/oauth/callback', profiles)?.id,
    'example-client',
  );
  assert.equal(
    resolveOAuthClient(CLAUDE_OAUTH_CALLBACK, profiles)?.id,
    'claude',
  );
  for (const value of [
    'https://client.example/oauth/callback?next=evil',
    'https://client.example.evil/oauth/callback',
    'https://client.example/other',
  ])
    assert.equal(resolveOAuthClient(value, profiles), null);
  assert.equal(
    resolveOAuthClient('https://client.example/oauth/callback', [
      ...profiles,
      { ...extra, id: 'ambiguous' },
    ]),
    null,
  );
  for (const value of [
    'https://chatgpt.com/connector/oauth/valid_id-1',
    'https://chatgpt.com/connector_platform_oauth_redirect',
  ])
    assert.equal(resolveOAuthClient(value, profiles)?.id, 'chatgpt');
  for (const value of [
    'https://chatgpt.com/connector/oauth/valid?next=evil',
    'https://chatgpt.com/connector/oauth/valid/other',
    'https://chatgpt.com.evil/connector/oauth/valid',
  ])
    assert.equal(resolveOAuthClient(value, profiles), null);
});
void test('desktop OAuth accepts exact ephemeral loopback callbacks and rejects redirects away from the listener', async () => {
  for (const redirect of [
    'http://127.0.0.1:54321/callback',
    'http://[::1]:54321/callback',
  ]) {
    assert.equal(allowedOAuthRedirect(redirect), true);
    const f = fixture(redirect);
    try {
      await f.manage('prepare', { workspace: f.w });
      const client = await (await f.register()).json().then(wire);
      const { code } = await f.authorize(client.client_id);
      const wrong = redirect.replace('54321', '54322');
      assert.equal(
        (await f.exchange(client.client_id, code, { redirect_uri: wrong }))
          .status,
        400,
      );
      const token = await (
        await f.exchange(client.client_id, code)
      )
        .json()
        .then(wire);
      assert.equal((await f.rpc(token.access_token)).status, 200);
    } finally {
      f.db.close();
    }
  }
  for (const redirect of [
    'http://127.1:54321/callback',
    'http://2130706433:54321/callback',
    'http://127.0.0.1.evil.example:54321/callback',
    'http://192.168.1.2:54321/callback',
    'http://127.0.0.1:80/callback',
    'http://127.0.0.1:65536/callback',
    'http://127.0.0.1:54321/other',
    'http://127.0.0.1:54321/callback?next=https://evil.example',
    'http://user@127.0.0.1:54321/callback',
  ])
    assert.equal(allowedOAuthRedirect(redirect), false, redirect);
});
const callback = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 's'.repeat(64);
type Wire = {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  code_challenge_methods_supported: string[];
  result: { tools: unknown[]; isError: boolean };
};
function wire(value: unknown) {
  return value as Wire;
}
function fixture(callbackUri = callback) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0003_mcp.sql', '0004_oauth.sql'])
    db.exec(
      readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
    );
  const binding = {
    prepare(q: string) {
      const s = db.prepare(q);
      const bind = (...args: SQLInputValue[]) => ({
        _run: () => ({ meta: { changes: Number(s.run(...args).changes) } }),
        run: async () => ({
          meta: { changes: Number(s.run(...args).changes) },
        }),
        first: async () => s.get(...args) ?? null,
        all: async () => ({ results: s.all(...args) }),
      });
      return { bind, ...bind() };
    },
    async batch(statements: { _run: () => unknown }[]) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => s._run());
        db.exec('COMMIT');
        return results;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
  const repo = mcpRepository(binding),
    oauth = oauthRepository(binding);
  let cookie = '';
  const w = blankWorkspace('OAuth isolated fixture');
  w.id = 'oauth-workspace';
  async function manage(action: string, body?: unknown) {
    const req = new Request('http://127.0.0.1:3000/api/mcp/' + action, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: 'http://127.0.0.1:3000',
        'X-Context-Hub': '1',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const r = await manageMcp(req, action, repo, {
      repo: oauth,
      origin: publicOrigin,
    });
    cookie = r.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return r;
  }
  async function post(
    action: string,
    body: Record<string, string>,
    extra: Record<string, string> = {},
  ) {
    return oauthHandler(
      new Request(publicOrigin + '/oauth/' + action, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...extra,
        },
        body: new URLSearchParams(body),
      }),
      action,
      oauth,
    );
  }
  async function register(method = 'none', redirect = callbackUri) {
    return oauthHandler(
      new Request(publicOrigin + '/oauth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          redirect_uris: [redirect],
          token_endpoint_auth_method: method,
          client_name: 'ChatGPT', // Untrusted metadata must not rename Claude grants.
        }),
      }),
      'register',
      oauth,
    );
  }
  async function start(client: string, overrides: Record<string, string> = {}) {
    const params = new URLSearchParams({
      client_id: client,
      redirect_uri: callbackUri,
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: await pkce(verifier),
      state: 'client-state',
      scope: 'context:tools',
      resource: publicOrigin + '/mcp/' + w.id,
      ...overrides,
    });
    const response = await oauthHandler(
      new Request(publicOrigin + '/oauth/authorize?' + params),
      'authorize',
      oauth,
    );
    const html = await response.text();
    return {
      response,
      html,
      id: html.match(/name="request_id" value="([a-f0-9]+)"/)?.[1] ?? '',
      csrf: html.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] ?? '',
      cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    };
  }
  async function authorize(client: string) {
    const b = await start(client);
    assert.equal(b.response.status, 200);
    assert.equal(
      (
        await manage('oauth', {
          action: 'inspect',
          workspaceId: w.id,
          requestId: b.id,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await manage('oauth', {
          action: 'approve',
          workspaceId: w.id,
          requestId: b.id,
        })
      ).status,
      200,
    );
    const done = await post(
      'complete',
      { request_id: b.id, csrf: b.csrf, decision: 'continue' },
      { Origin: publicOrigin, Cookie: b.cookie },
    );
    assert.equal(done.status, 303, await done.text());
    const location = new URL(done.headers.get('location')!);
    assert.equal(location.origin, new URL(callbackUri).origin);
    assert.equal(location.pathname, new URL(callbackUri).pathname);
    assert.equal(location.searchParams.get('iss'), publicOrigin);
    assert.equal(location.searchParams.get('state'), 'client-state');
    return { code: location.searchParams.get('code')!, browser: b };
  }
  const exchange = (
    client: string,
    code: string,
    more: Record<string, string> = {},
  ) =>
    post('token', {
      client_id: client,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: callbackUri,
      resource: publicOrigin + '/mcp/' + w.id,
      ...more,
    });
  const refresh = (client: string, token: string) =>
    post('token', {
      client_id: client,
      grant_type: 'refresh_token',
      refresh_token: token,
      resource: publicOrigin + '/mcp/' + w.id,
    });
  async function rpc(
    access: string,
    method = 'tools/list',
    params: object = {},
    wid = w.id,
  ) {
    return mcpHandler(
      new Request(publicOrigin + '/mcp/' + wid, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + access,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
      wid,
      repo,
      undefined,
      publicOrigin,
    );
  }
  return {
    db,
    repo,
    oauth,
    w,
    manage,
    post,
    register,
    start,
    authorize,
    exchange,
    refresh,
    rpc,
  };
}

for (const [redirect, clientName] of [
  [callback, 'ChatGPT'],
  [CLAUDE_OAUTH_CALLBACK, 'Claude'],
])
  void test(`${clientName}: OAuth discovery, local consent, PKCE, tools, refresh rotation, audience and revocation work together`, async () => {
    const f = fixture(redirect);
    try {
      assert.equal((await f.manage('prepare', { workspace: f.w })).status, 200);
      const unauthorized = await f.rpc('');
      assert.equal(unauthorized.status, 401);
      assert.match(
        unauthorized.headers.get('www-authenticate')!,
        /resource_metadata="https:\/\/oauth-fixture.example\/\.well-known\/oauth-protected-resource\/mcp\/oauth-workspace"/,
      );
      const meta = await oauthMetadata(publicOrigin).json().then(wire);
      assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
      const client = await (await f.register()).json().then(wire);
      const { code, browser } = await f.authorize(client.client_id);
      assert.ok(browser.html.includes(`<h1>连接 ${clientName}</h1>`));
      assert.ok(browser.html.includes(`完成授权，返回 ${clientName}`));
      assert.ok(
        browser.response.headers
          .get('content-security-policy')!
          .includes(`form-action 'self' ${redirect};`),
      );
      assert.equal(
        (
          await f.exchange(client.client_id, code, {
            code_verifier: 'x'.repeat(64),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await f.exchange(client.client_id, code, {
            resource: publicOrigin + '/mcp/other',
          })
        ).status,
        400,
      );
      const result = await f.exchange(client.client_id, code);
      assert.equal(result.status, 200);
      const token = await result.json().then(wire);
      assert.equal((await f.exchange(client.client_id, code)).status, 400);
      assert.equal(
        (await (await f.rpc(token.access_token)).json().then(wire)).result.tools
          .length,
        7,
      );
      assert.equal(
        (await f.rpc(token.access_token, 'tools/list', {}, 'other')).status,
        401,
      );
      const create = await (
        await f.rpc(token.access_token, 'tools/call', {
          name: 'note_create',
          arguments: {
            title: 'OAuth note',
            body: 'saved through OAuth',
            star: false,
            request_id: 'oauth-write',
          },
        })
      )
        .json()
        .then(wire);
      assert.equal(create.result.isError, false);
      f.db
        .prepare('UPDATE mcp_oauth_grants SET expires_at=?')
        .run(Date.now() + 90000);
      const renewal = await f.refresh(client.client_id, token.refresh_token);
      assert.equal(renewal.status, 200);
      const renewed = await renewal.json().then(wire);
      assert.ok(
        renewed.expires_in > 0 && renewed.expires_in <= 90,
        'access lifetime cannot outlive consent',
      );
      assert.equal((await f.rpc(token.access_token)).status, 401);
      const retry = await (
        await f.rpc(renewed.access_token, 'tools/call', {
          name: 'note_create',
          arguments: {
            title: 'OAuth note',
            body: 'saved through OAuth',
            star: false,
            request_id: 'oauth-write',
          },
        })
      )
        .json()
        .then(wire);
      assert.deepEqual(
        retry.result,
        create.result,
        'write idempotency survives refresh',
      );
      const row = await f.repo.token(await digest(renewed.access_token));
      assert.ok(row);
      assert.equal(row.name, `${clientName} · OAuth`);
      await f.repo.revoke(row.owner_id, row.workspace_id, row.id);
      assert.equal((await f.rpc(renewed.access_token)).status, 401);
      assert.equal(
        (await f.refresh(client.client_id, renewed.refresh_token)).status,
        400,
      );
      assert.equal(
        f.db.prepare('SELECT COUNT(*) AS n FROM mcp_receipts').get()!.n,
        1,
      );
    } finally {
      f.db.close();
    }
  });

void test('Claude only accepts its exact official callback, including at registration', async () => {
  const f = fixture(CLAUDE_OAUTH_CALLBACK);
  try {
    assert.equal(oauthClientName(CLAUDE_OAUTH_CALLBACK), 'Claude');
    for (const redirect of [
      'https://claude.ai.evil.example/api/mcp/auth_callback',
      'https://claude.ai@evil.example/api/mcp/auth_callback',
      'https://user@claude.ai/api/mcp/auth_callback',
      'http://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback/other',
      'https://claude.ai/api/mcp/auth_callback?next=https://evil.example',
      'https://claude.ai/api/mcp/auth_callback#fragment',
      'https://claude.ai/api/mcp/%61uth_callback',
      'https://claude.ai:444/api/mcp/auth_callback',
    ]) {
      assert.equal(allowedOAuthRedirect(redirect), false, redirect);
      assert.equal((await f.register('none', redirect)).status, 400, redirect);
    }
  } finally {
    f.db.close();
  }
});

void test('Claude and ChatGPT clients cannot exchange or refresh each other grants', async () => {
  const f = fixture(CLAUDE_OAUTH_CALLBACK);
  try {
    await f.manage('prepare', { workspace: f.w });
    const claude = await (await f.register()).json().then(wire);
    const chatgpt = await (
      await f.register('none', callback)
    )
      .json()
      .then(wire);
    assert.equal((await f.start(chatgpt.client_id)).response.status, 400);
    const request = await f.start(claude.client_id);
    const inspected = await f.manage('oauth', {
      action: 'inspect',
      requestId: request.id,
      workspaceId: f.w.id,
    });
    assert.equal(
      ((await inspected.json()) as { clientName: string }).clientName,
      'Claude',
    );
    // Rejection must return to Claude with the original state and without a code.
    await f.manage('oauth', {
      action: 'deny',
      requestId: request.id,
      workspaceId: f.w.id,
    });
    const denied = await f.post(
      'complete',
      { request_id: request.id, csrf: request.csrf, decision: 'continue' },
      { Origin: publicOrigin, Cookie: request.cookie },
    );
    const deniedUrl = new URL(denied.headers.get('location')!);
    assert.equal(deniedUrl.origin + deniedUrl.pathname, CLAUDE_OAUTH_CALLBACK);
    assert.equal(deniedUrl.searchParams.get('error'), 'access_denied');
    assert.equal(deniedUrl.searchParams.get('state'), 'client-state');
    assert.equal(deniedUrl.searchParams.has('code'), false);
    const { code } = await f.authorize(claude.client_id);
    assert.equal((await f.exchange(chatgpt.client_id, code)).status, 400);
    const token = await (
      await f.exchange(claude.client_id, code)
    )
      .json()
      .then(wire);
    assert.equal(
      (await f.refresh(chatgpt.client_id, token.refresh_token)).status,
      400,
    );
    assert.equal(
      (await f.refresh(claude.client_id, token.refresh_token)).status,
      200,
    );
  } finally {
    f.db.close();
  }
});

void test('OAuth rejects wrong callbacks, downgraded PKCE, excess scope, missing owner approval and CSRF', async () => {
  const f = fixture();
  try {
    await f.manage('prepare', { workspace: f.w });
    assert.equal(
      (await f.register('none', 'https://chatgpt.com.evil.example/callback'))
        .status,
      400,
    );
    assert.equal(
      (await f.register('none', callback + '?next=https://evil.example'))
        .status,
      400,
    );
    const c = await (await f.register()).json().then(wire);
    const invalid: Record<string, string>[] = [
      { code_challenge_method: 'plain' },
      { scope: 'context:tools admin' },
      { resource: 'https://other.example/mcp/oauth-workspace' },
      { redirect_uri: 'https://evil.example' },
    ];
    for (const overrides of invalid)
      assert.equal(
        (await f.start(c.client_id, overrides)).response.status,
        400,
      );
    const b = await f.start(c.client_id);
    assert.equal(
      (
        await f.post(
          'complete',
          { request_id: b.id, csrf: b.csrf, decision: 'continue' },
          { Origin: publicOrigin, Cookie: b.cookie },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.manage('oauth', {
          action: 'approve',
          requestId: b.id,
          workspaceId: 'other',
        })
      ).status,
      404,
    );
    await f.manage('oauth', {
      action: 'approve',
      requestId: b.id,
      workspaceId: f.w.id,
    });
    assert.equal(
      (
        await f.post(
          'complete',
          { request_id: b.id, csrf: b.csrf, decision: 'continue' },
          { Origin: 'https://evil.example', Cookie: b.cookie },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.post(
          'complete',
          { request_id: b.id, csrf: b.csrf, decision: 'continue' },
          { Origin: publicOrigin },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.manage('oauth', {
          action: 'approve',
          requestId: b.id,
          workspaceId: f.w.id,
        })
      ).status,
      409,
    );
    const cancel = await f.post(
      'complete',
      { request_id: b.id, csrf: b.csrf, decision: 'cancel' },
      { Origin: publicOrigin, Cookie: b.cookie },
    );
    assert.equal(
      new URL(cancel.headers.get('location')!).searchParams.get('error'),
      'access_denied',
    );
    assert.equal(
      (
        await f.post(
          'complete',
          { request_id: b.id, csrf: b.csrf, decision: 'continue' },
          { Origin: publicOrigin, Cookie: b.cookie },
        )
      ).status,
      400,
      'cancellation consumes the request',
    );
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM mcp_tokens').get()!.n,
      0,
    );
  } finally {
    f.db.close();
  }
});

void test('OAuth public-client refresh reuse revokes the family; reset removes grants and pending approved codes', async () => {
  const f = fixture();
  try {
    await f.manage('prepare', { workspace: f.w });
    const c = await (await f.register()).json().then(wire);
    const { code } = await f.authorize(c.client_id);
    const first = await (await f.exchange(c.client_id, code)).json().then(wire);
    const second = await (
      await f.refresh(c.client_id, first.refresh_token)
    )
      .json()
      .then(wire);
    assert.equal(
      (await f.refresh(c.client_id, first.refresh_token)).status,
      400,
    );
    assert.equal((await f.rpc(second.access_token)).status, 401);
    assert.equal(
      (await f.refresh(c.client_id, second.refresh_token)).status,
      400,
    );
    const waiting = await f.authorize(c.client_id);
    assert.equal((await f.manage('reset', {})).status, 200);
    assert.equal((await f.exchange(c.client_id, waiting.code)).status, 400);
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM mcp_oauth_grants').get()!.n,
      0,
    );
    assert.equal(
      f.db.prepare('SELECT COUNT(*) AS n FROM mcp_oauth_refresh_history').get()!
        .n,
      0,
    );
  } finally {
    f.db.close();
  }
});

void test('confidential OAuth clients require their registered authentication method', async () => {
  const f = fixture();
  try {
    await f.manage('prepare', { workspace: f.w });
    const c = await (await f.register('client_secret_post')).json().then(wire);
    const { code } = await f.authorize(c.client_id);
    assert.equal((await f.exchange(c.client_id, code)).status, 401);
    assert.equal(
      (await f.exchange(c.client_id, code, { client_secret: 'wrong' })).status,
      401,
    );
    const token = await (
      await f.exchange(c.client_id, code, { client_secret: c.client_secret })
    )
      .json()
      .then(wire);
    assert.equal((await f.rpc(token.access_token)).status, 200);
    const revoke = await f.post('revoke', {
      client_id: c.client_id,
      client_secret: c.client_secret,
      token: token.refresh_token,
    });
    assert.equal(revoke.status, 200);
    assert.equal((await f.rpc(token.access_token)).status, 401);
    const basic = await (
      await f.register('client_secret_basic')
    )
      .json()
      .then(wire);
    const auth = await f.authorize(basic.client_id);
    const r = await f.post(
      'token',
      {
        grant_type: 'authorization_code',
        code: auth.code,
        code_verifier: verifier,
        redirect_uri: callback,
        resource: publicOrigin + '/mcp/' + f.w.id,
      },
      {
        Authorization:
          'Basic ' + btoa(basic.client_id + ':' + basic.client_secret),
      },
    );
    assert.equal(r.status, 200);
  } finally {
    f.db.close();
  }
});

void test('OAuth gateway identity cannot be spoofed with Host or forwarding headers', () => {
  const config = {
    CONTEXT_HUB_MCP_PUBLIC_ORIGIN: publicOrigin,
    CONTEXT_HUB_MCP_GATEWAY_KEY: 'a'.repeat(64),
  };
  assert.throws(() =>
    gatewayRequest(
      new Request('http://127.0.0.1:3000/oauth/authorize', {
        headers: { 'X-Forwarded-Host': 'evil.example' },
      }),
      config,
    ),
  );
  assert.throws(() =>
    gatewayRequest(
      new Request('http://evil.example/oauth/authorize', {
        headers: { 'x-context-hub-gateway-key': 'a'.repeat(64) },
      }),
      config,
    ),
  );
  assert.equal(
    gatewayRequest(
      new Request('http://127.0.0.1:3000/oauth/authorize', {
        headers: {
          'x-context-hub-gateway-key': 'a'.repeat(64),
          'X-Forwarded-Host': 'evil.example',
        },
      }),
      config,
    ).url,
    publicOrigin + '/oauth/authorize',
  );
});
