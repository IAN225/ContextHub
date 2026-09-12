import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request } from 'node:http';
import { unstable_dev } from 'wrangler';
import { openAccessStore } from '../scripts/server/access-store.mjs';
import { createServerService } from '../scripts/server/service.mjs';
import { createMcpGateway } from '../scripts/mcp-gateway.mjs';
import { blankWorkspace } from '../lib/domain.ts';

// Real built Worker/D1, synthetic data, no provider calls or certificate issuance.
const temporary = await mkdtemp(join(tmpdir(), 'context-hub-server-http-'));
const publicOrigin = 'https://server-fixture.example';
const servers = [];
let worker;
async function cleanup() {
  const target = resolve(temporary);
  if (
    dirname(target) !== resolve(tmpdir()) ||
    !basename(target).startsWith('context-hub-server-http-')
  )
    throw new Error('Unsafe cleanup target');
  await rm(target, { recursive: true, force: true });
}
async function listen(server) {
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}
try {
  const store = await openAccessStore(join(temporary, 'server'));
  const envFile = join(temporary, 'runtime.env'),
    persistTo = join(temporary, 'state');
  await writeFile(
    envFile,
    `CONTEXT_HUB_MCP_PUBLIC_ORIGIN=${publicOrigin}\nCONTEXT_HUB_MCP_GATEWAY_KEY=${store.gatewayKey}\n`,
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
  const gatewayPort = await listen(
    createMcpGateway({
      origin: publicOrigin,
      key: store.gatewayKey,
      target: `http://127.0.0.1:${worker.port}`,
    }),
  );
  const service = createServerService(
    store,
    { configure: async () => {} },
    { appPort: worker.port, mcpPort: gatewayPort },
  );
  const localPort = await listen(createServer(service.handler(true)));
  const publicPort = await listen(createServer(service.handler(false)));
  async function call(
    path,
    { local = false, method = 'GET', data, cookie, headers = {} } = {},
  ) {
    const port = local ? localPort : publicPort;
    const origin = local ? `http://127.0.0.1:${localPort}` : publicOrigin;
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            Host: new URL(origin).host,
            ...(!local && { 'X-Forwarded-Proto': 'https' }),
            Origin: origin,
            'Content-Type': 'application/json',
            'X-Context-Hub-Server': '1',
            ...(cookie && { Cookie: cookie }),
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text,
              json: () => JSON.parse(text),
            }),
          );
        },
      );
      req.setTimeout(15000, () =>
        req.destroy(new Error('HTTP integration timed out')),
      );
      req.on('error', reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  const password = 'http-integration-password';
  assert.equal(
    (
      await call('/api/server/setup', {
        local: true,
        method: 'POST',
        data: { password },
      })
    ).status,
    200,
  );
  await store.saveAccess({
    mode: 'external',
    origin: publicOrigin,
    issuer: 'Fixture',
    expiresAt: '2027-01-01T00:00:00Z',
    checkedAt: new Date().toISOString(),
  });
  const page = await call('/server');
  assert.equal(page.status, 200, page.text.slice(0, 500));
  assert.match(page.text, /服务器访问/);
  const assets = [
    ...new Set(
      [
        ...page.text.matchAll(
          /(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css))"/g,
        ),
      ].map((m) => m[1]),
    ),
  ];
  assert.ok(assets.length > 0, 'login page includes build assets');
  for (const asset of assets)
    assert.equal((await call(asset)).status, 200, asset);
  assert.equal(
    (await call('/api/mcp/status', { headers: { 'X-Context-Hub': '1' } }))
      .status,
    401,
  );
  const login = await call('/api/server/login', {
    method: 'POST',
    data: { password },
  });
  assert.equal(login.status, 200);
  const adminCookie = login.headers['set-cookie'][0].split(';')[0];
  const managed = await call('/api/mcp/status', {
    cookie: adminCookie,
    headers: { 'X-Context-Hub': '1' },
  });
  assert.equal(managed.status, 200, managed.text);
  assert.equal(managed.json().publicOrigin, publicOrigin);
  const workspace = blankWorkspace('Server integration workspace');
  const token = await call('/api/mcp/token', {
    method: 'POST',
    cookie: adminCookie,
    headers: { 'X-Context-Hub': '1' },
    data: {
      action: 'create',
      workspace,
      name: 'Server integration client',
      ttl: 3600,
    },
  });
  assert.equal(token.status, 200, token.text);
  assert.ok(token.json().secret);
  assert.ok(
    token.headers['set-cookie'].some((value) => value.includes('; Secure')),
  );
  const discovery = await call('/.well-known/oauth-authorization-server');
  assert.equal(discovery.status, 200, discovery.text);
  assert.equal(discovery.json().issuer, publicOrigin);
  const note = await call(`/mcp/${workspace.id}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.json().secret}`,
      Accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'note_create',
        arguments: {
          title: 'Server proxy note',
          body: 'real Worker write',
          star: false,
          request_id: 'server-http-create',
        },
      },
    },
  });
  assert.equal(note.status, 200, note.text);
  assert.equal(note.json().result.isError, false, note.text);
  const noteId = note.json().result.structuredContent.id;
  const read = await call(`/mcp/${workspace.id}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.json().secret}`,
      Accept: 'application/json, text/event-stream',
    },
    data: {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'note_read', arguments: { note_id: noteId } },
    },
  });
  assert.equal(read.json().result.structuredContent.body, 'real Worker write');
  assert.equal(
    (await call('/v1/models')).status,
    401,
    'public delivery still requires its own bearer key',
  );
  console.log(
    'PASS built server page and static assets, administrator gate, real Worker management, OAuth discovery, two-stage MCP gateway note write/read and independent delivery authentication.',
  );
} finally {
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (worker) await worker.stop();
  await cleanup();
}
