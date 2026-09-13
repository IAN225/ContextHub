import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { openAccounts } from '../scripts/server/accounts.mjs';
import { openAccessStore } from '../scripts/server/access-store.mjs';
import { createServerService } from '../scripts/server/service.mjs';
const password = 'synthetic-activation-password-123';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'contexthub-lifecycle-'));
  const accounts = await openAccounts(dir);
  t.after(async () => {
    accounts.close();
    if (
      dirname(resolve(dir)) !== resolve(tmpdir()) ||
      !basename(dir).startsWith('contexthub-lifecycle-')
    )
      throw Error('Unsafe cleanup');
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, accounts };
}
async function activate(accounts) {
  const initial = await accounts.initializeDeployment();
  const password = (await readFile(initial.passwordFile, 'utf8')).trim();
  const session = await accounts.login('admin', password);
  await accounts.password(session.user.id, password, 'changed-' + password);
  return { user: session.user, password: 'changed-' + password };
}
void test('fresh deployment creates a random administrator once, activation requires a different password and survives restart', async (t) => {
  const { dir, accounts } = await fixture(t);
  const result = await accounts.initializeDeployment();
  const first = (await readFile(result.passwordFile, 'utf8')).trim();
  assert.ok(first.length >= 32);
  if (process.platform !== 'win32')
    assert.equal((await stat(result.passwordFile)).mode & 0o777, 0o600);
  assert.equal(accounts.state().activated, false);
  const login = await accounts.login('admin', first);
  assert.equal(login.user.mustChangePassword, true);
  assert.throws(() => accounts.entries(login.user.id), /激活/);
  await assert.rejects(accounts.register('alice', password), /关闭/);
  await assert.rejects(accounts.password(login.user.id, first, first), /相同/);
  assert.equal((await accounts.initializeDeployment()).created, false);
  assert.equal((await readFile(result.passwordFile, 'utf8')).trim(), first);
  await accounts.password(login.user.id, first, password);
  assert.equal(accounts.state().activated, true);
  assert.equal(accounts.state().registrationOpen, true);
  assert.equal(accounts.user(login.token), null);
  assert.equal(await accounts.login('admin', first), null);
  await assert.rejects(readFile(result.passwordFile), { code: 'ENOENT' });
  const reopened = await openAccounts(dir);
  try {
    assert.equal((await reopened.initializeDeployment()).activated, true);
    assert.ok(await reopened.login('admin', password));
  } finally {
    reopened.close();
  }
});
void test('pending registration, approval, rejection, closing registration and live role checks enforce permissions', async (t) => {
  const { accounts } = await fixture(t);
  const { user: admin } = await activate(accounts);
  await accounts.register('alice', password);
  await assert.rejects(accounts.login('alice', password), /等待/);
  let state = accounts.management(admin.id);
  const alice = state.users.find((u) => u.username === 'alice');
  assert.equal(alice.role, 'user');
  assert.equal(alice.status, 'pending');
  assert.throws(() => accounts.entries(alice.id), /失效/);
  state = accounts.manage(admin.id, {
    action: 'registration',
    open: false,
    revision: state.revision,
  });
  await assert.rejects(accounts.register('bob', password), /关闭/);
  state = accounts.manage(admin.id, {
    action: 'review',
    userId: alice.id,
    approve: true,
    revision: state.revision,
  });
  const session = await accounts.login('alice', password);
  assert.throws(() => accounts.management(alice.id), /管理员/);
  assert.throws(
    () =>
      accounts.manage(alice.id, {
        action: 'role',
        userId: alice.id,
        role: 'admin',
        revision: state.revision,
      }),
    /管理员/,
  );
  const stale = state.revision;
  state = accounts.manage(admin.id, {
    action: 'role',
    userId: alice.id,
    role: 'admin',
    revision: state.revision,
  });
  assert.equal(accounts.user(session.token).role, 'admin');
  assert.throws(
    () =>
      accounts.manage(admin.id, {
        action: 'role',
        userId: alice.id,
        role: 'user',
        revision: stale,
      }),
    /更新/,
  );
  state = accounts.manage(alice.id, {
    action: 'role',
    userId: admin.id,
    role: 'user',
    revision: state.revision,
  });
  assert.throws(() => accounts.management(admin.id), /管理员/);
  assert.throws(
    () =>
      accounts.manage(alice.id, {
        action: 'role',
        userId: alice.id,
        role: 'user',
        revision: state.revision,
      }),
    /至少一名/,
  );
  state = accounts.manage(alice.id, {
    action: 'registration',
    open: true,
    revision: state.revision,
  });
  await accounts.register('bob', password);
  state = accounts.management(alice.id);
  const bob = state.users.find((u) => u.username === 'bob');
  accounts.manage(alice.id, {
    action: 'review',
    userId: bob.id,
    approve: false,
    revision: state.revision,
  });
  await assert.rejects(accounts.login('bob', password), /未通过/);
  assert.ok(
    !JSON.stringify(accounts.management(alice.id)).includes('password_hash'),
  );
});
void test('existing account database retains data and credentials while requiring the initial administrator to activate once', async (t) => {
  const { dir, accounts } = await fixture(t);
  const admin = await accounts.create('admin', password, 'admin');
  accounts.write(admin.id, {
    mode: 'write',
    generation: 0,
    commitId: crypto.randomUUID(),
    entries: [{ key: 'private', revision: 0, value: { note: 'retain' } }],
  });
  const result = await accounts.initializeDeployment();
  assert.equal(result.created, false);
  assert.equal(result.passwordFile, undefined);
  const session = await accounts.login('admin', password);
  assert.equal(session.user.mustChangePassword, true);
  await accounts.password(admin.id, password, password + '-new');
  assert.equal(accounts.read(admin.id, 'private').entry.value.note, 'retain');
  const db = new DatabaseSync(join(dir, 'accounts.sqlite'));
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  } finally {
    db.close();
  }
});
void test('HTTP activation gate also blocks MCP, delivery, legacy local setup and server settings', async (t) => {
  const { accounts, dir } = await fixture(t);
  const initial = await accounts.initializeDeployment();
  const first = (await readFile(initial.passwordFile, 'utf8')).trim();
  const access = await openAccessStore(dir);
  const service = createServerService(
    access,
    { configure: async () => {} },
    { accounts },
  );
  const server = createServer(service.handler(true));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const origin = 'http://127.0.0.1:' + server.address().port;
  let cookie = '',
    user = '';
  async function call(path, data) {
    return fetch(origin + path, {
      method: data ? 'POST' : 'GET',
      redirect: 'manual',
      headers: {
        Origin: origin,
        'X-Context-Hub': '1',
        'X-Context-Hub-Server': '1',
        'X-Context-Hub-User': user,
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  }
  const login = await call('/api/account/login', {
    username: 'admin',
    password: first,
  });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  user = (await login.json()).user.id;
  for (const path of [
    '/api/account/data',
    '/api/account/management',
    '/api/mcp/status',
    '/api/server/status',
    '/mcp/test',
    '/v1/models',
  ])
    assert.equal((await call(path)).status, 403, path);
  assert.equal((await call('/')).headers.get('location'), '/activate');
  assert.equal((await call('/api/server/setup', { password })).status, 403);
  assert.equal(
    (await call('/api/account/password', { currentPassword: first, password }))
      .status,
    200,
  );
  const again = await call('/api/account/login', {
    username: 'admin',
    password,
  });
  cookie = again.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/account/management')).status, 200);
  assert.equal(
    (await call('/api/server/login', { password: first })).status,
    403,
  );
  assert.equal(
    (
      await call('/api/account/register', {
        username: 'alice',
        password,
        role: 'admin',
        status: 'active',
      })
    ).status,
    201,
  );
  assert.equal(
    accounts.management(user).users.find((u) => u.username === 'alice').status,
    'pending',
  );
  assert.equal(
    (await call('/api/account/login', { username: 'alice', password })).status,
    403,
  );
  assert.equal((await call('/api/account/management')).status, 200);
});
