import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApplicationSession } from '../lib/application/client-session.ts';
import { createTaskSession } from '../lib/tasks/session.ts';
import { accountFetch } from '../lib/account/fetch.ts';
import { createRequestScope } from '../lib/client/request-scope.ts';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const snapshot = (revision = 1) => ({
  generation: 1,
  revisions: { 'hub.v2/index': revision },
  state: { schemaVersion: 1, workspaces: [], uploads: [] },
});
test('definite conflict releases pending command; refresh does not resubmit stale content', async () => {
  let revision = 1,
    writes = 0;
  const session = createApplicationSession(async (_, init) => {
    if (init.method === 'POST') {
      writes++;
      return writes === 1
        ? Response.json({ error: 'revision conflict' }, { status: 409 })
        : Response.json(snapshot(revision));
    }
    return Response.json(snapshot(revision));
  });
  await session.refresh();
  assert.equal(
    await session.commit({ type: 'notification/read', notificationId: 'test' }),
    false,
  );
  assert.match(session.getSnapshot().error, /conflict/);
  revision = 2;
  await session.retry();
  assert.equal(writes, 1);
  assert.equal(
    await session.commit({ type: 'notification/read', notificationId: 'test' }),
    true,
  );
  assert.equal(writes, 2);
});
test('late workspace GET cannot poison newer snapshot ETag', async () => {
  const slow = deferred();
  let n = 0,
    last;
  const session = createApplicationSession(async (_, init) => {
    n++;
    last = init.headers;
    return n === 1
      ? slow.promise
      : Response.json(snapshot(2), { headers: { etag: 'new' } });
  });
  const a = session.refresh();
  await session.refresh();
  slow.resolve(Response.json(snapshot(1), { headers: { etag: 'old' } }));
  await a;
  await session.refresh();
  assert.equal(last['If-None-Match'], 'new');
});
test('task state ignores out-of-order reads and replies from an ended view', async () => {
  const first = deferred(),
    second = deferred(),
    third = deferred();
  let count = 0;
  const session = createTaskSession(
    async () => [first, second, third][count++].promise,
  );
  const a = session.refresh(),
    b = session.refresh();
  second.resolve({ ready: true, tasks: [{ id: 'new' }], candidates: {} });
  await b;
  first.resolve({ ready: true, tasks: [{ id: 'old' }], candidates: {} });
  await a;
  assert.equal(session.getSnapshot().tasks[0].id, 'new');
  const c = session.refresh();
  session.setEnabled(false);
  third.resolve({ ready: true, tasks: [{ id: 'stale' }], candidates: {} });
  await c;
  assert.equal(session.getSnapshot().tasks[0].id, 'new');
});
test('task commands invalidate old polls and always release submission state', async () => {
  const old = deferred(),
    write = deferred();
  let lists = 0;
  const session = createTaskSession(async (action) =>
    action === 'enqueue'
      ? write.promise
      : ++lists === 1
        ? old.promise
        : { ready: true, tasks: [{ id: 'queued' }], candidates: {} },
  );
  const poll = session.refresh();
  const task = session.startAttachment({ id: 'attachment' });
  write.resolve({ task: { id: 'queued' } });
  await task;
  old.resolve({ ready: true, tasks: [], candidates: {} });
  await poll;
  assert.equal(session.getSnapshot().tasks[0].id, 'queued');
  assert.equal(session.getSnapshot().submitting, false);
});
test('account fetch fences outstanding and future requests after session change', async () => {
  const slow = deferred();
  const events = [];
  let count = 0;
  const fetcher = accountFetch(
    async () =>
      ++count === 1
        ? slow.promise
        : Response.json(
            { error: '登录账号已变化，请刷新页面。' },
            { status: 409 },
          ),
    'old-user',
    'https://example.test',
    (e) => events.push(e),
  );
  const outstanding = fetcher('/api/workspaces');
  await fetcher('/api/workspaces');
  slow.resolve(Response.json(snapshot()));
  await assert.rejects(outstanding, /登录状态/);
  await assert.rejects(
    fetcher('/api/workspaces', { method: 'POST' }),
    /登录状态/,
  );
  assert.equal(count, 2);
  assert.deepEqual(events, ['expired']);
});
test('ordinary revision conflicts do not invalidate account and external requests get no account headers', async () => {
  const calls = [];
  const fetcher = accountFetch(
    async (input, init) => {
      calls.push(init);
      return Response.json({ error: 'revision conflict' }, { status: 409 });
    },
    'owner',
    'https://example.test',
    () => assert.fail('not auth conflict'),
  );
  await fetcher('/api/workspaces');
  await fetcher('https://elsewhere.test/path');
  assert.equal(calls[0].headers.get('X-Context-Hub-User'), 'owner');
  assert.equal(calls[1], undefined);
});
test('view identity cannot revive an old completion after navigating away and back', () => {
  const scope = createRequestScope(),
    old = scope.capture();
  scope.invalidate();
  scope.invalidate();
  assert.equal(old(), false);
  assert.equal(scope.capture()(), true);
});
