import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAccounts } from '../scripts/server/accounts.mjs';
import { createAccessController } from '../scripts/server/access-controller.mjs';
import { createServerService } from '../scripts/server/service.mjs';
import { CLIENT_PROTOCOL } from '../lib/storage/protocol.ts';

test('account activation, approval, roles, credentials and data survive reopening the database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'contexthub-accounts-'));
  let accounts;
  try {
    accounts = await openAccounts(directory);
    const setup = await accounts.initializeDeployment();
    const password = (await readFile(setup.passwordFile, 'utf8')).trimEnd();
    assert.equal(accounts.state().activated, false);
    assert.equal(await accounts.login('admin', 'wrong-password'), null);
    const admin = await accounts.login('admin', password);
    assert.ok(admin);
    assert.equal(accounts.state().activated, true);
    accounts.keepPassword(admin.token);
    assert.equal(accounts.user(admin.token).passwordSetupPending, false);
    await accounts.register('reader', 'reader-password-123');
    await assert.rejects(
      accounts.login('reader', 'reader-password-123'),
      /审批/,
    );
    const state = accounts.management(admin.user.id);
    const reader = state.users.find((u) => u.username === 'reader');
    accounts.manage(admin.user.id, {
      revision: state.revision,
      action: 'review',
      userId: reader.id,
      approve: true,
    });
    assert.throws(
      () =>
        accounts.manage(admin.user.id, {
          revision: state.revision,
          action: 'registration',
          open: false,
        }),
      /已更新/,
    );
    const login = await accounts.login('reader', 'reader-password-123');
    assert.ok(login);
    assert.throws(() => accounts.management(reader.id), /管理员/);
    const transaction = {
      generation: 0,
      mode: 'write',
      commitId: 'transaction_00001',
      entries: [{ key: 'test-draft', revision: 0, value: { text: 'saved' } }],
    };
    const saved = accounts.write(reader.id, transaction);
    assert.deepEqual(accounts.write(reader.id, transaction), saved);
    assert.throws(
      () =>
        accounts.write(reader.id, {
          ...transaction,
          commitId: 'transaction_00002',
        }),
      /另一页面/,
    );
    assert.equal(
      accounts.read(admin.user.id, 'test-draft').entry.value,
      undefined,
    );
    await accounts.password(
      reader.id,
      undefined,
      'changed-password-123',
      login.token,
    );
    assert.equal(accounts.user(login.token), null);
    assert.equal(await accounts.login('reader', 'reader-password-123'), null);
    accounts.close();
    accounts = await openAccounts(directory);
    assert.ok(await accounts.login('reader', 'changed-password-123'));
    assert.deepEqual(accounts.read(reader.id, 'test-draft').entry.value, {
      text: 'saved',
    });
    const current = accounts.management(admin.user.id);
    accounts.manage(admin.user.id, {
      revision: current.revision,
      action: 'registration',
      open: false,
    });
    await assert.rejects(
      accounts.register('another', 'another-password-123'),
      /关闭/,
    );
  } finally {
    accounts?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('certificate controller validates before commit, rolls back failed changes and clears challenges', async () => {
  const previous = { mode: 'automatic', origin: 'https://old.example' };
  const configured = [],
    proxies = [];
  const store = {
    access: previous,
    saveAccess: async (next) => {
      store.access = next;
    },
  };
  const runtime = { configure: async (origin) => configured.push(origin) };
  const good = createAccessController(store, runtime, {
    resolve: async () => {},
    caddy: async (values) => proxies.push(values),
    probe: async () => ({ issuer: 'test', expiresAt: '2027-01-01' }),
    probeAttempts: 1,
  });
  good.begin({ mode: 'automatic', origin: 'https://new.example' });
  assert.throws(() => good.begin(previous), /正在处理/);
  await good.whenIdle();
  assert.equal(store.access.origin, 'https://new.example');
  assert.equal(good.challenges.size, 0);
  assert.equal(good.status().error, '');
  const failed = createAccessController(store, runtime, {
    resolve: async () => {},
    caddy: async (values) => proxies.push(values),
    probe: async () => {
      throw Error('certificate failed');
    },
    probeAttempts: 1,
  });
  failed.begin({ mode: 'automatic', origin: 'https://bad.example' });
  await failed.whenIdle();
  assert.equal(store.access.origin, 'https://new.example');
  assert.equal(failed.status().pending, null);
  assert.equal(failed.challenges.size, 0);
  assert.match(failed.status().error, /certificate failed/);
  assert.deepEqual(configured, ['https://new.example']);
  assert.equal(proxies.at(-1)[0].origin, 'https://new.example');
  await failed.check();
  assert.match(failed.status().error, /HTTPS 检查失败/);
});

test('gateway keeps public HTTP, private runner and account administration boundaries', async () => {
  const store = {
    access: { origin: 'https://example.test' },
    gatewayKey: 'test',
    authenticated: () => false,
  };
  const user = { id: 'reader-id', role: 'user' };
  const accounts = {
    state: () => ({ activated: true }),
    user: () => user,
    list: () => [user],
  };
  const service = createServerService(store, {}, { accounts });
  async function request(
    url,
    { local = true, publicHttp = true, method = 'GET', headers = {} } = {},
  ) {
    const req = {
      url,
      method,
      headers: { host: local ? '192.0.2.1:8080' : 'example.test', ...headers },
      socket: { remoteAddress: '192.0.2.2' },
    };
    const result = { headers: {}, status: 0 };
    const res = {
      setHeader: (k, v) => (result.headers[k] = v),
      writeHead: (s, h) => {
        result.status = s;
        Object.assign(result.headers, h);
      },
      end: (v) => (result.body = v ? JSON.parse(v) : null),
    };
    await service.handler(local, publicHttp)(req, res);
    return result;
  }
  assert.equal((await request('/mcp/example')).status, 403);
  assert.equal((await request('/healthz')).status, 404);
  assert.equal(
    (await request('/api/tasks/runner-claim', { method: 'POST' })).status,
    404,
  );
  assert.equal(
    (
      await request('/api/server/configure', {
        method: 'POST',
        headers: {
          'x-context-hub-version': CLIENT_PROTOCOL,
          origin: 'http://192.0.2.1:8080',
          'x-context-hub-server': '1',
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request('/api/server/configure', { method: 'POST' })).status,
    426,
  );
  assert.equal(
    (
      await request('/server', {
        local: false,
        publicHttp: false,
        headers: { 'x-forwarded-proto': 'https' },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request('/api/server/status', {
        headers: { host: 'evil.example:8080' },
      })
    ).status,
    403,
  );
});
