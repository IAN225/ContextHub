import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createServer, request as httpRequest } from 'node:http';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { openAccessStore } from '../scripts/server/access-store.mjs';
import { createServerService } from '../scripts/server/service.mjs';
import {
  accessInput,
  resolvePublicHost,
  caddyConfiguration,
  probeHttps,
} from '../scripts/server/tls.mjs';

const password = 'local-test-password-123';
const certificate = {
  issuer: 'Test CA',
  expiresAt: '2027-01-01T00:00:00.000Z',
  checkedAt: '2026-09-12T00:00:00.000Z',
};
async function storeFor(t) {
  const dir = await mkdtemp(join(tmpdir(), 'contexthub-server-test-'));
  t.after(() => {
    const target = resolve(dir);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('contexthub-server-test-')
    )
      throw new Error('Unsafe cleanup target');
    return rm(target, { recursive: true, force: true });
  });
  return { store: await openAccessStore(dir), dir };
}
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return server.address().port;
}
async function harness(t, options = {}) {
  const { store, dir } = await storeFor(t);
  const requests = [],
    runtimeCalls = [],
    caddyCalls = [];
  const upstream = await listen(t, (req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.setHeader('Set-Cookie', 'app_owner=test; Path=/; HttpOnly');
    res.end(JSON.stringify({ upstream: true }));
  });
  const service = createServerService(
    store,
    {
      configure: async (origin) => {
        runtimeCalls.push(origin);
        if (options.failRuntime === origin) throw new Error('runtime failed');
      },
    },
    {
      appPort: upstream,
      mcpPort: upstream,
      caddy: async (config) => {
        caddyCalls.push(config);
      },
      resolve: async () => {},
      probe: async () => certificate,
      probeAttempts: 1,
      ...options,
    },
  );
  const localPort = await listen(t, service.handler(true));
  const publicPort = await listen(t, service.handler(false));
  async function call(
    path,
    {
      local = true,
      origin = 'https://hub.example.com',
      method = 'GET',
      data,
      cookie,
      headers = {},
    } = {},
  ) {
    const port = local ? localPort : publicPort;
    const expected = local ? `http://127.0.0.1:${port}` : origin;
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            Host: new URL(expected).host,
            ...(!local && { 'X-Forwarded-Proto': 'https' }),
            ...(method === 'POST' && {
              Origin: expected,
              'X-Context-Hub-Server': '1',
              'Content-Type': 'application/json',
            }),
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
      req.on('error', reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  async function setup() {
    const response = await call('/api/server/setup', {
      method: 'POST',
      data: { password },
    });
    assert.equal(response.status, 200, response.text);
    return response.headers['set-cookie'][0].split(';')[0];
  }
  return {
    store,
    dir,
    service,
    call,
    setup,
    requests,
    runtimeCalls,
    caddyCalls,
    upstream,
  };
}

void test('administrator credentials and sessions persist as hashes, separate local/public sessions and revoke on logout', async (t) => {
  const { store, dir } = await storeFor(t);
  await assert.rejects(store.initialize('short'));
  await store.initialize(password);
  await assert.rejects(store.initialize(password));
  assert.equal(await store.login('wrong', true), null);
  const token = await store.login(password, true);
  assert.equal(store.authenticated(token, true), true);
  assert.equal(store.authenticated(token, false), false);
  const raw = await readFile(join(dir, 'access.json'), 'utf8');
  assert.ok(!raw.includes(password) && !raw.includes(token));
  const reopened = await openAccessStore(dir);
  assert.equal(reopened.gatewayKey, store.gatewayKey);
  assert.equal(reopened.authenticated(token, true), true);
  await reopened.logout(token);
  assert.equal(reopened.authenticated(token, true), false);
  const corrupted = JSON.parse(raw);
  corrupted.admin.hash = 'invalid';
  await writeFile(join(dir, 'access.json'), JSON.stringify(corrupted));
  await assert.rejects(openAccessStore(dir), /Invalid server access state/);
});

void test('setup is loopback-only, requires same-origin intent and cannot be taken over twice', async (t) => {
  const h = await harness(t);
  assert.equal(
    (await h.call('/api/server/status', { headers: { Host: 'evil.example' } }))
      .status,
    403,
  );
  assert.equal(
    (
      await h.call('/api/server/setup', {
        method: 'POST',
        data: { password },
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.call('/api/server/setup', {
        method: 'POST',
        data: { password },
        headers: { 'X-Context-Hub-Server': '' },
      })
    ).status,
    403,
  );
  const cookie = await h.setup();
  assert.equal(
    (await h.call('/api/server/setup', { method: 'POST', data: { password } }))
      .status,
    400,
  );
  await h.store.saveAccess({
    mode: 'external',
    origin: 'https://hub.example.com',
    ...certificate,
  });
  assert.equal(
    (
      await h.call('/api/server/setup', {
        local: false,
        method: 'POST',
        data: { password },
      })
    ).status,
    403,
  );
  assert.equal(
    (await h.call('/api/server/status', { local: false, cookie })).json()
      .authenticated,
    false,
  );
  assert.equal((await h.call('/api/server/status')).json().access, undefined);
  assert.equal(
    (await h.call('/api/server/status', { cookie })).json().access.origin,
    'https://hub.example.com',
  );
});

void test('public administration is gated, while MCP and delivery keep their own authentication paths', async (t) => {
  const h = await harness(t);
  await h.setup();
  await h.store.saveAccess({
    mode: 'external',
    origin: 'https://hub.example.com',
    ...certificate,
  });
  assert.equal(
    (await h.call('/api/mcp/settings', { local: false })).status,
    401,
  );
  assert.equal((await h.call('/', { local: false })).status, 302);
  assert.equal((await h.call('/server', { local: false })).status, 200);
  assert.equal(
    (await h.call('/_next/static/page-test.js', { local: false })).status,
    200,
  );
  assert.equal(
    (await h.call('/_next/image?url=/api/secrets', { local: false })).status,
    302,
  );
  assert.equal(
    (await h.call('/_next/static/%2e%2e/%2e%2e/api/secrets', { local: false }))
      .status,
    401,
  );
  assert.equal(
    (
      await h.call('/mcp/workspace_1', {
        local: false,
        headers: { Authorization: 'Bearer mcp-token' },
      })
    ).status,
    200,
  );
  assert.equal(h.requests.at(-1).headers.authorization, 'Bearer mcp-token');
  assert.equal(h.requests.at(-1).headers.host, 'hub.example.com');
  assert.equal((await h.call('/v1/models', { local: false })).status, 200);
  assert.equal((await h.call('/v1/internal', { local: false })).status, 302);
  assert.equal(
    (
      await h.call('/api/server/status', {
        local: false,
        headers: { 'X-Forwarded-Proto': 'http' },
      })
    ).status,
    403,
  );
  const login = await h.call('/api/server/login', {
    local: false,
    method: 'POST',
    data: { password },
  });
  const setCookie = login.headers['set-cookie'][0];
  assert.match(setCookie, /^__Host-ch_server=/);
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
  const cookie = setCookie.split(';')[0];
  const result = await h.call('/api/mcp/settings', {
    local: false,
    method: 'POST',
    cookie,
    data: {},
    headers: {
      'X-Context-Hub': '1',
      'X-Forwarded-Host': 'evil.example',
      'X-Context-Hub-Gateway-Key': 'forged',
    },
  });
  assert.equal(result.status, 200);
  const forwarded = h.requests.at(-1).headers;
  assert.equal(forwarded.origin, `http://127.0.0.1:${h.upstream}`);
  assert.equal(forwarded['x-context-hub'], '1');
  assert.equal(forwarded['x-forwarded-host'], undefined);
  assert.equal(forwarded['x-context-hub-gateway-key'], undefined);
  assert.ok(!forwarded.cookie?.includes('__Host-ch_server'));
  assert.match(result.headers['set-cookie'][0], /; Secure$/);
  assert.equal(
    (
      await h.call('/api/mcp/settings', {
        local: false,
        method: 'POST',
        cookie,
        data: {},
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  await h.call('/api/server/logout', { local: false, method: 'POST', cookie });
  assert.equal(
    (await h.call('/api/mcp/settings', { local: false, cookie })).status,
    401,
  );
});

void test('automatic HTTPS requires terms and only commits after certificate and instance verification', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const h = await harness(t, {
    probe: async () => {
      await gate;
      return certificate;
    },
  });
  const cookie = await h.setup();
  const data = { mode: 'automatic', origin: 'hub.example.com' };
  assert.equal(
    (await h.call('/api/server/configure', { method: 'POST', cookie, data }))
      .status,
    400,
  );
  data.acceptAcmeTerms = true;
  assert.equal(
    (await h.call('/api/server/configure', { method: 'POST', cookie, data }))
      .status,
    202,
  );
  assert.equal(h.store.access, null);
  assert.equal(h.service.status().pending.origin, 'https://hub.example.com');
  assert.equal(
    (await h.call('/api/server/configure', { method: 'POST', cookie, data }))
      .status,
    400,
  );
  assert.equal((await h.call('/mcp/test', { local: false })).status, 503);
  release();
  await h.service.whenIdle();
  assert.equal(h.store.access.origin, 'https://hub.example.com');
  assert.equal(h.store.access.issuer, 'Test CA');
  assert.deepEqual(h.runtimeCalls, ['https://hub.example.com']);
  assert.equal(h.caddyCalls.length, 2);
  assert.equal(
    (await openAccessStore(h.dir)).access.origin,
    'https://hub.example.com',
  );
});

void test('failed verification preserves existing address without restarting application', async (t) => {
  const h = await harness(t, {
    probe: async () => {
      throw new Error('wrong instance');
    },
  });
  const cookie = await h.setup();
  const old = {
    mode: 'automatic',
    origin: 'https://old.example.com',
    ...certificate,
  };
  await h.store.saveAccess(old);
  const data = {
    mode: 'automatic',
    origin: 'new.example.com',
    acceptAcmeTerms: true,
  };
  assert.equal(
    (await h.call('/api/server/configure', { method: 'POST', cookie, data }))
      .status,
    409,
  );
  assert.equal(
    (
      await h.call('/api/server/configure', {
        method: 'POST',
        cookie,
        data: { ...data, confirmOriginChange: true },
      })
    ).status,
    202,
  );
  await h.service.whenIdle();
  assert.deepEqual(h.store.access, old);
  assert.deepEqual(h.runtimeCalls, []);
  assert.deepEqual(h.caddyCalls.at(-1), [old]);
  assert.match(h.service.status().error, /wrong instance/);
});

void test('failed application activation restores previous runtime and Caddy configuration', async (t) => {
  const h = await harness(t, { failRuntime: 'https://new.example.com' });
  const cookie = await h.setup();
  const old = {
    mode: 'automatic',
    origin: 'https://old.example.com',
    ...certificate,
  };
  await h.store.saveAccess(old);
  await h.call('/api/server/configure', {
    method: 'POST',
    cookie,
    data: {
      mode: 'automatic',
      origin: 'new.example.com',
      acceptAcmeTerms: true,
      confirmOriginChange: true,
    },
  });
  await h.service.whenIdle();
  assert.deepEqual(h.runtimeCalls, [
    'https://new.example.com',
    'https://old.example.com',
  ]);
  assert.deepEqual(h.store.access, old);
  assert.deepEqual(h.caddyCalls.at(-1), [old]);
});

void test('existing HTTPS mode never controls Caddy and periodic checks update certificate status', async (t) => {
  let nonceValue;
  const h = await harness(t, {
    probe: async (_origin, nonce) => {
      nonceValue = nonce;
      return certificate;
    },
  });
  const cookie = await h.setup();
  await h.call('/api/server/configure', {
    method: 'POST',
    cookie,
    data: { mode: 'external', origin: 'hub.example.com' },
  });
  await h.service.whenIdle();
  assert.deepEqual(h.caddyCalls, []);
  await h.service.check();
  assert.equal(h.store.access.checkedAt, certificate.checkedAt);
  assert.equal(
    (await h.call(`/api/server/probe?nonce=${nonceValue}`, { local: false }))
      .status,
    404,
  );
});

void test('login attempts are rate limited', async (t) => {
  const h = await harness(t);
  await h.setup();
  for (let i = 0; i < 9; i++)
    assert.equal(
      (
        await h.call('/api/server/login', {
          method: 'POST',
          data: { password: 'incorrect' },
        })
      ).status,
      401,
    );
  assert.equal(
    (await h.call('/api/server/login', { method: 'POST', data: { password } }))
      .status,
    429,
  );
});

void test('domain validation excludes paths, credentials, IPs, custom ports and non-public DNS', async () => {
  assert.deepEqual(
    accessInput({ mode: 'automatic', origin: 'Hub.Example.com' }),
    { mode: 'automatic', origin: 'https://hub.example.com' },
  );
  for (const origin of [
    'http://hub.example.com',
    'https://u:p@hub.example.com',
    'hub.example.com/path',
    'hub.example.com:8443',
    '127.0.0.1',
    '[::1]',
    'localhost',
    '-a.example.com',
  ]) {
    assert.throws(() => accessInput({ mode: 'automatic', origin }));
  }
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '::1',
    'fc00::1',
    '192.0.2.1',
  ]) {
    await assert.rejects(
      resolvePublicHost('https://hub.example.com', async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
    );
  }
  await assert.rejects(
    resolvePublicHost('https://hub.example.com', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]),
  );
  assert.equal(
    (
      await resolvePublicHost('https://hub.example.com', async () => [
        { address: '8.8.8.8', family: 4 },
      ])
    ).length,
    1,
  );
});

void test('Caddy configuration binds administration to loopback and covers only automatic domains', () => {
  const config = caddyConfiguration([
    { mode: 'automatic', origin: 'https://hub.example.com' },
    { mode: 'automatic', origin: 'https://new.example.com' },
    { mode: 'external', origin: 'https://external.example.com' },
  ]);
  assert.equal(config.admin.listen, '127.0.0.1:2019');
  const route = config.apps.http.servers.context_hub.routes[0];
  assert.deepEqual(route.match[0].host, ['hub.example.com', 'new.example.com']);
  assert.equal(route.handle[0].upstreams[0].dial, '127.0.0.1:4080');
  assert.equal(caddyConfiguration([]).apps, undefined);
});

void test('HTTPS probe pins the validated address and requires an exact instance nonce, never follows redirects', async () => {
  let lookupCalls = 0,
    body = { nonce: 'secret-nonce' },
    statusCode = 200;
  const resolver = async () => {
    lookupCalls++;
    return [{ address: '8.8.8.8', family: 4 }];
  };
  const request = (url, options, callback) => {
    assert.equal(url.hostname, 'hub.example.com');
    assert.equal(options.rejectUnauthorized, undefined);
    options.lookup(url.hostname, {}, (_error, address, family) => {
      assert.equal(address, '8.8.8.8');
      assert.equal(family, 4);
    });
    options.lookup(url.hostname, { all: true }, (_error, addresses) =>
      assert.equal(addresses[0].address, '8.8.8.8'),
    );
    const req = new EventEmitter();
    req.destroy = (error) => req.emit('error', error);
    req.end = () =>
      queueMicrotask(() => {
        const res = Readable.from([JSON.stringify(body)]);
        res.statusCode = statusCode;
        res.socket = {
          getPeerCertificate: () => ({
            valid_to: 'Jan 1 00:00:00 2027 GMT',
            issuer: { CN: 'Test CA' },
          }),
        };
        callback(res);
      });
    return req;
  };
  assert.equal(
    (
      await probeHttps(
        'https://hub.example.com',
        'secret-nonce',
        resolver,
        request,
      )
    ).issuer,
    'Test CA',
  );
  assert.equal(lookupCalls, 1);
  body = { nonce: 'wrong-nonce' };
  await assert.rejects(
    probeHttps('https://hub.example.com', 'secret-nonce', resolver, request),
    /本实例/,
  );
  statusCode = 302;
  await assert.rejects(
    probeHttps('https://hub.example.com', 'secret-nonce', resolver, request),
  );
});
