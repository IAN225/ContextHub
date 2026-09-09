import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentSession } from '../lib/persistent-session.ts';
import type { Repository, StorageEntry } from '../lib/repository.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function controlled(value: unknown) {
  const pending: {
    entries: readonly StorageEntry[];
    done: ReturnType<typeof deferred<void>>;
  }[] = [];
  const repository: Repository = {
    read: () => Promise.resolve(value),
    write(entries) {
      const done = deferred<void>();
      pending.push({ entries, done });
      return done.promise;
    },
  };
  return { repository, pending };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

void test('failed reads cannot write initial data; retry recovers the actual stored value', async () => {
  let fails = true;
  const writes: unknown[] = [];
  const session = createPersistentSession('draft', 'initial', {
    read: () =>
      fails
        ? Promise.reject(new Error('read failed'))
        : Promise.resolve('stored'),
    write: (entries) => {
      writes.push(entries);
      return Promise.resolve();
    },
  });
  await session.load();
  session.update('replacement');
  assert.equal(await session.commit('cleared'), false);
  assert.equal(session.getSnapshot().ready, false);
  assert.match(session.getSnapshot().error, /读取/);
  assert.deepEqual(writes, []);
  fails = false;
  await session.retry();
  assert.equal(session.getSnapshot().value, 'stored');
  assert.equal(session.getSnapshot().saved, true);
  assert.deepEqual(writes, []);
});

void test('changing storage keys isolates delayed results and pending saves', async () => {
  const read = deferred<unknown>();
  const writes: readonly StorageEntry[][] = [];
  const repository: Repository = {
    read: (key) => (key === 'a' ? read.promise : Promise.resolve('B')),
    write: (entries) => {
      (writes as StorageEntry[][]).push([...entries]);
      return Promise.resolve();
    },
  };
  const a = createPersistentSession('a', '', repository);
  const b = createPersistentSession('b', '', repository);
  const pending = a.load();
  await b.load();
  b.update('new B');
  read.resolve('A');
  await pending;
  assert.equal(a.getSnapshot().value, 'A');
  assert.equal(b.getSnapshot().value, 'new B');
  assert.deepEqual(writes, [[{ key: 'b', value: 'new B' }]]);
});

void test('an older write completion cannot mark newer input as saved', async () => {
  const { repository, pending } = controlled('first');
  const session = createPersistentSession('draft', '', repository);
  await session.load();
  session.update('second');
  session.update('third');
  pending[0].done.resolve();
  await settle();
  assert.equal(session.getSnapshot().saved, false);
  assert.equal(session.getSnapshot().value, 'third');
  pending[1].done.resolve();
  await settle();
  assert.equal(session.getSnapshot().saved, true);
});

void test('a failed autosave keeps the latest draft and retry writes that draft', async () => {
  const { repository, pending } = controlled('old');
  const session = createPersistentSession('draft', '', repository);
  await session.load();
  session.update('unsaved');
  pending[0].done.reject(new Error('quota'));
  await settle();
  assert.equal(session.getSnapshot().value, 'unsaved');
  assert.match(session.getSnapshot().error, /保存失败/);
  const retry = session.retry();
  assert.deepEqual(pending[1].entries, [{ key: 'draft', value: 'unsaved' }]);
  pending[1].done.resolve();
  await retry;
  assert.equal(session.getSnapshot().saved, true);
  assert.equal(session.getSnapshot().error, '');
});

void test('atomic commit failure preserves current state and never clears the companion draft', async () => {
  const { repository, pending } = controlled({ count: 1 });
  const session = createPersistentSession('hub', { count: 0 }, repository);
  await session.load();
  const commit = session.commit(
    (s) => ({ count: s.count + 1 }),
    [{ key: 'draft', value: '' }],
  );
  assert.deepEqual(session.getSnapshot().value, { count: 1 });
  assert.deepEqual(pending[0].entries, [
    { key: 'hub', value: { count: 2 } },
    { key: 'draft', value: '' },
  ]);
  pending[0].done.reject(new Error('transaction aborted'));
  assert.equal(await commit, false);
  assert.deepEqual(session.getSnapshot().value, { count: 1 });
  assert.equal(session.getSnapshot().busy, false);
});

void test('ordinary updates during a durable commit run against its successful result', async () => {
  const { repository, pending } = controlled({ count: 1, name: 'old' });
  const session = createPersistentSession(
    'hub',
    { count: 0, name: '' },
    repository,
  );
  await session.load();
  const commit = session.commit((s) => ({ ...s, count: s.count + 1 }));
  session.update((s) => ({ ...s, name: 'new' }));
  pending[0].done.resolve();
  assert.equal(await commit, true);
  assert.deepEqual(session.getSnapshot().value, { count: 2, name: 'new' });
  assert.equal(session.getSnapshot().saved, false);
  pending[1].done.resolve();
  await settle();
  assert.equal(session.getSnapshot().saved, true);
});

void test('draft clear waits for the business transaction and survives a failed transaction', async () => {
  const { repository } = controlled('my draft');
  const draft = createPersistentSession('draft', '', repository);
  await draft.load();
  const failed = deferred<boolean>();
  const first = draft.commitWith('', (entry) => {
    assert.deepEqual(entry, { key: 'draft', value: '' });
    return failed.promise;
  });
  assert.equal(draft.getSnapshot().value, 'my draft');
  failed.resolve(false);
  assert.equal(await first, false);
  assert.equal(draft.getSnapshot().value, 'my draft');
  assert.equal(await draft.commitWith('', () => Promise.resolve(true)), true);
  assert.equal(draft.getSnapshot().value, '');
  assert.equal(draft.getSnapshot().saved, true);
});

void test('unreadable or future state is not automatically replaced', async () => {
  const { repository, pending } = controlled({ schemaVersion: 100 });
  const session = createPersistentSession(
    'hub',
    { count: 0 },
    repository,
    () => {
      throw new Error('unsupported');
    },
  );
  await session.load();
  assert.equal(session.getSnapshot().ready, false);
  assert.deepEqual(pending, []);
});
void test('old drafts gain only missing defaults while preserving saved content and extra fields', async () => {
  const writes: readonly StorageEntry[][] = [];
  const session = createPersistentSession(
    'draft',
    { body: '', star: false },
    {
      read: () => Promise.resolve({ body: 'preserve me', extra: 7 }),
      write: (entries) => {
        (writes as StorageEntry[][]).push([...entries]);
        return Promise.resolve();
      },
    },
  );
  await session.load();
  assert.deepEqual(session.getSnapshot().value, {
    body: 'preserve me',
    star: false,
    extra: 7,
  });
  assert.equal(writes.length, 1);
});
