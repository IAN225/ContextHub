import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { openAccounts } from '../scripts/server/accounts.mjs';
import { openAccessStore } from '../scripts/server/access-store.mjs';
import { createServerService } from '../scripts/server/service.mjs';
const password = 'synthetic-account-password-123';
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'contexthub-accounts-'));
  const store = await openAccounts(dir);
  t.after(async () => {
    store.close();
    const target = resolve(dir);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('contexthub-accounts-')
    )
      throw Error('Unsafe test path');
    await rm(target, { recursive: true, force: true });
  });
  return { dir, store };
}
function input(entries, generation = 0) {
  return { mode: 'write', generation, commitId: randomUUID(), entries };
}
void test('password hashing, role, independent sessions, password change and durable account data', async (t) => {
  const { dir, store } = await setup(t);
  const alice = await store.create('Alice', password),
    bob = await store.create('bob', password);
  assert.equal(alice.username, 'alice');
  assert.equal(alice.role, 'user');
  assert.equal(await store.login('alice', 'wrong'), null);
  const a = await store.login('ALICE', password),
    a2 = await store.login('alice', password),
    b = await store.login('bob', password);
  assert.equal(store.user(a.token).id, alice.id);
  assert.ok(
    !(await readFile(join(dir, 'accounts.sqlite'))).includes(
      Buffer.from(password),
    ),
  );
  store.write(
    alice.id,
    input([
      {
        key: 'hub-state-v1',
        revision: 0,
        value: {
          notes: ['private'],
          attachment: 'data:text/plain;base64,aGVsbG8=',
        },
      },
      { key: 'note-draft-test', revision: 0, value: { body: 'draft' } },
    ]),
  );
  assert.equal(store.read(bob.id, 'hub-state-v1').entry.value, undefined);
  const reopened = await openAccounts(dir);
  assert.equal(
    reopened.read(alice.id, 'hub-state-v1').entry.value.notes[0],
    'private',
  );
  assert.equal(reopened.user(a.token).id, alice.id);
  reopened.close();
  await store.password(alice.id, password, password + '-new');
  assert.equal(store.user(a.token), null);
  assert.equal(store.user(a2.token), null);
  assert.equal(store.user(b.token).id, bob.id);
  assert.equal(await store.login('alice', password), null);
  assert.ok(await store.login('alice', password + '-new'));
});
void test('atomic records, idempotent saves, stale device conflicts, tombstones and restore generations', async (t) => {
  const { store } = await setup(t);
  const user = await store.create('alice', password);
  const commit = input([
    { key: 'hub', value: { note: 'one' }, revision: 0 },
    { key: 'draft', value: { text: 'draft' }, revision: 0 },
  ]);
  const saved = store.write(user.id, commit);
  assert.deepEqual(store.write(user.id, commit), saved);
  assert.throws(
    () =>
      store.write(user.id, {
        ...commit,
        entries: [{ key: 'hub', value: 'altered', revision: 0 }],
      }),
    /编号冲突/,
  );
  assert.throws(
    () =>
      store.write(
        user.id,
        input([
          { key: 'draft', revision: 1, value: 'changed' },
          { key: 'hub', revision: 0, value: 'stale' },
        ]),
      ),
    /另一页面/,
  );
  assert.equal(
    store.read(user.id, 'draft').entry.value.text,
    'draft',
    'all-or-nothing',
  );
  store.write(user.id, input([{ key: 'draft', revision: 1 }]));
  assert.throws(
    () =>
      store.write(
        user.id,
        input([{ key: 'draft', revision: 0, value: 'resurrect' }]),
      ),
    /另一页面/,
  );
  const before = store.entries(user.id);
  store.write(user.id, {
    ...input([{ key: 'hub', value: { note: 'restored' }, revision: 1 }]),
    mode: 'replace',
    expected: before.entries,
  });
  assert.throws(
    () =>
      store.write(
        user.id,
        input([{ key: 'new', value: 'old tab', revision: 0 }]),
      ),
    /恢复/,
  );
  assert.equal(store.read(user.id, 'hub').entry.value.note, 'restored');
});
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  return server.address().port;
}
void test('HTTP account boundary rejects cross-account headers, ordinary-user administration and expired sessions', async (t) => {
  const { store, dir } = await setup(t);
  const admin = await store.create('admin', password, 'admin'),
    alice = await store.create('alice', password),
    bob = await store.create('bob', password);
  const access = await openAccessStore(dir);
  await access.initialize(password);
  await access.saveAccess({
    origin: 'https://hub.example',
    mode: 'external',
    issuer: 'test',
    expiresAt: '2030-01-01',
    checkedAt: '2026-09-13',
  });
  const upstream = await listen(t, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        account: req.headers['x-context-hub-account'],
        key: req.headers['x-context-hub-account-key'],
        cookie: req.headers.cookie,
      }),
    );
  });
  const service = createServerService(
    access,
    { configure: async () => {} },
    { accounts: store, appPort: upstream, mcpPort: upstream },
  );
  const port = await listen(t, service.handler(false));
  async function call(
    path,
    { data, cookie = '', user = '', headers = {} } = {},
  ) {
    const body = data === undefined ? undefined : JSON.stringify(data);
    return new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Host: 'hub.example',
            'X-Forwarded-Proto': 'https',
            Origin: 'https://hub.example',
            'X-Context-Hub': '1',
            'X-Context-Hub-Server': '1',
            'X-Context-Hub-User': user,
            Cookie: cookie,
            'Content-Type': 'application/json',
            ...headers,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: text ? JSON.parse(text) : null,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }
  assert.equal((await call('/')).headers.location, '/login');
  const login = await call('/api/account/login', {
    data: { username: 'alice', password },
  });
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  assert.match(login.headers['set-cookie'][0], /HttpOnly.*Secure/);
  const opts = { cookie, user: alice.id };
  assert.equal(
    (await call('/api/server/configure', { ...opts, data: {} })).status,
    403,
  );
  assert.equal((await call('/server', opts)).status, 403);
  assert.equal(
    (await call('/api/tasks/runner-claim', { ...opts, data: {} })).status,
    403,
  );
  assert.equal(
    (await call('/api/account/data', { ...opts, user: bob.id })).status,
    409,
  );
  assert.equal(
    (
      await call('/api/account/data', {
        ...opts,
        data: input([]),
        headers: { Origin: 'https://evil.example' },
      })
    ).status,
    403,
  );
  const proxied = await call('/api/mcp/status', {
    ...opts,
    headers: {
      'X-Context-Hub-Account': bob.id,
      'X-Context-Hub-Account-Key': 'forged',
      Cookie: cookie + '; context_hub_mcp=old-anonymous-cookie',
    },
  });
  assert.equal(proxied.status, 200);
  assert.equal(proxied.body.account, alice.id);
  assert.equal(proxied.body.key, access.gatewayKey);
  assert.ok(!proxied.body.cookie?.includes('old-anonymous-cookie'));
  const adminLogin = await call('/api/account/login', {
    data: { username: 'admin', password },
  });
  assert.equal(
    (
      await call('/api/server/status', {
        cookie: adminLogin.headers['set-cookie'][0].split(';')[0],
        user: admin.id,
      })
    ).body.authenticated,
    true,
  );
  assert.equal((await call('/api/server/status', opts)).body.access, undefined);
  assert.equal(
    (await call('/api/account/logout', { ...opts, data: {} })).status,
    200,
  );
  assert.equal((await call('/api/account/data', opts)).status, 401);
});
