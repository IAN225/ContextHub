import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unstable_dev } from 'wrangler';
import { createMcpGateway } from '../scripts/mcp-gateway.mjs';
import { blankWorkspace } from '../lib/domain.ts';
import { pkce } from '../lib/mcp/server/oauth.ts';

const temporary = await mkdtemp(join(tmpdir(), 'context-hub-oauth-http-'));
const publicOrigin = 'https://oauth-http-fixture.example';
const gatewayKey = 'd'.repeat(64);
let worker, gateway;
async function cleanup() {
  const target = resolve(temporary);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('context-hub-oauth-http-')
  )
    throw new Error('Unsafe cleanup target');
  await rm(target, { recursive: true, force: true });
}
try {
  const envFile = join(temporary, '.env.test'),
    persistTo = join(temporary, 'state');
  await writeFile(
    envFile,
    `CONTEXT_HUB_MCP_PUBLIC_ORIGIN=${publicOrigin}\nCONTEXT_HUB_MCP_GATEWAY_KEY=${gatewayKey}\n`,
  );
  await promisify(execFile)(
    process.execPath,
    [
      '--import',
      './scripts/local-runtime.mjs',
      './node_modules/wrangler/bin/wrangler.js',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--config',
      'dist/server/wrangler.json',
      '--persist-to',
      persistTo,
    ],
    { windowsHide: true },
  );
  async function start() {
    worker = await unstable_dev('dist/server/index.js', {
      config: 'dist/server/wrangler.json',
      envFiles: [envFile],
      port: 0,
      inspectorPort: 0,
      ip: '127.0.0.1',
      local: true,
      persist: true,
      persistTo,
      logLevel: 'none',
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
      },
    });
    const local = `http://${worker.address}:${worker.port}`;
    gateway = createMcpGateway({
      origin: publicOrigin,
      key: gatewayKey,
      target: local,
    });
    await new Promise((resolve, reject) => {
      gateway.once('error', reject);
      gateway.listen(0, '127.0.0.1', resolve);
    });
    return { local, remote: `http://127.0.0.1:${gateway.address().port}` };
  }
  let { local, remote } = await start(),
    cookie = '';
  async function managed(action, body) {
    const r = await fetch(local + '/api/mcp/' + action, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: local,
        'X-Context-Hub': '1',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    cookie = r.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    return r;
  }
  async function post(action, body, headers = {}) {
    return fetch(remote + '/oauth/' + action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams(body),
      redirect: 'manual',
    });
  }
  // The public gateway must not expose a UI, configuration, management or task API.
  for (const path of [
    '/',
    '/api/mcp/status',
    '/api/mcp/token',
    '/api/summary/configure',
    '/api/tasks/runner-claim',
    '/api/imports/keys',
    '/mcp/../../api/mcp/status',
    '/%61pi/mcp/status',
  ])
    assert.equal((await fetch(remote + path)).status, 404, path);
  const forged = await fetch(local + '/oauth/authorize', {
    headers: { 'X-Forwarded-Host': publicOrigin },
  });
  assert.equal(forged.status, 403);
  const w = blankWorkspace('OAuth HTTP synthetic');
  w.id = 'oauth-http';
  assert.equal((await managed('prepare', { workspace: w })).status, 200);
  const endpoint = '/mcp/' + w.id,
    resource = publicOrigin + endpoint;
  const unauth = await fetch(remote + endpoint);
  assert.equal(unauth.status, 401);
  const challenge = unauth.headers.get('www-authenticate');
  assert.ok(
    challenge.includes(
      resource.replace('/mcp/', '/.well-known/oauth-protected-resource/mcp/'),
    ),
  );
  const protectedMeta = await fetch(
    remote + '/.well-known/oauth-protected-resource' + endpoint,
  );
  assert.equal(protectedMeta.status, 200);
  assert.equal((await protectedMeta.json()).resource, resource);
  const as = await fetch(remote + '/.well-known/oauth-authorization-server');
  assert.equal(as.status, 200);
  assert.equal((await as.json()).issuer, publicOrigin);
  const registration = await fetch(remote + '/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      token_endpoint_auth_method: 'none',
    }),
  });
  assert.equal(registration.status, 201);
  const client = await registration.json();
  const verifier = 'h'.repeat(64),
    redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const auth = await fetch(
    remote +
      '/oauth/authorize?' +
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: 'context:tools',
        resource,
        state: 'http-state',
        code_challenge_method: 'S256',
        code_challenge: await pkce(verifier),
      }),
  );
  assert.equal(auth.status, 200);
  const html = await auth.text();
  const requestId = html.match(/name="request_id" value="([a-f0-9]+)"/)[1];
  const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)[1];
  const browserCookie = auth.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (
      await managed('oauth', {
        action: 'approve',
        requestId,
        workspaceId: w.id,
      })
    ).status,
    200,
  );
  const complete = await post(
    'complete',
    { request_id: requestId, csrf, decision: 'continue' },
    { Origin: publicOrigin, Cookie: browserCookie },
  );
  assert.equal(complete.status, 303, await complete.text());
  const returned = new URL(complete.headers.get('location'));
  assert.equal(returned.searchParams.get('iss'), publicOrigin);
  assert.equal(returned.searchParams.get('state'), 'http-state');
  const exchanged = await post('token', {
    client_id: client.client_id,
    grant_type: 'authorization_code',
    code: returned.searchParams.get('code'),
    code_verifier: verifier,
    redirect_uri: redirect,
    resource,
  });
  assert.equal(exchanged.status, 200);
  let token = await exchanged.json();
  async function rpc(method, params = {}) {
    const r = await fetch(remote + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer ' + token.access_token,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    assert.equal(r.status, 200);
    return r.json();
  }
  const init = await rpc('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'synthetic ChatGPT', version: '1' },
    capabilities: {},
  });
  assert.equal(init.result.serverInfo.name, 'ContextHub');
  assert.equal((await rpc('tools/list')).result.tools.length, 7);
  const note = await rpc('tools/call', {
    name: 'note_create',
    arguments: {
      title: 'HTTP OAuth note',
      body: 'preserved across restart',
      star: true,
      request_id: 'oauth-http-write',
    },
  });
  assert.equal(note.result.isError, false);
  await new Promise((resolve) => gateway.close(resolve));
  gateway = undefined;
  await worker.stop();
  worker = undefined;
  ({ local, remote } = await start());
  assert.equal((await rpc('tools/list')).result.tools.length, 7);
  const renewal = await post('token', {
    client_id: client.client_id,
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    resource,
  });
  assert.equal(renewal.status, 200);
  token = await renewal.json();
  const read = await rpc('tools/call', {
    name: 'note_read',
    arguments: { note_id: note.result.structuredContent.id },
  });
  assert.equal(read.result.structuredContent.body, 'preserved across restart');
  const revoke = await post('revoke', {
    client_id: client.client_id,
    token: token.refresh_token,
  });
  assert.equal(revoke.status, 200);
  assert.equal(
    (
      await fetch(remote + endpoint, {
        headers: { Authorization: 'Bearer ' + token.access_token },
      })
    ).status,
    401,
  );
  console.log(
    'PASS OAuth HTTP: real Worker and bounded gateway, discovery, DCR, owner approval, PKCE, seven tools, restart, refresh and revocation; private app routes stay inaccessible.',
  );
} finally {
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  if (worker) await worker.stop();
  await cleanup();
}
