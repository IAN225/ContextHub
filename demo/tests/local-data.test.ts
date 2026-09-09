import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedDbRepository } from '../lib/repository.ts';
import {
  createEmptyHubState,
  normalizeHubState,
  type HubState,
} from '../lib/hub-state.ts';
import { blankWorkspace } from '../lib/domain.ts';
import { createPersistentSession } from '../lib/persistent-session.ts';
import {
  backupState,
  createBackup,
  parseBackup,
  restoreBackup,
} from '../lib/backup.ts';
import {
  expiredTrash,
  purgeTrash,
  TRASH_RETENTION_MS,
} from '../lib/recycle-bin.ts';

const at = Date.parse('2026-09-10T12:00:00Z');
const deletedAt = new Date(at - TRASH_RETENTION_MS).toISOString();
function fixture(): HubState {
  const w = blankWorkspace('自己的手账');
  w.id = 'w';
  w.config.auto = true;
  w.turns = ['before', 'removed', 'after'].map((id) => ({
    id,
    title: id,
    time: null,
    source: 'manual',
    status: id === 'removed' ? 'trash' : 'normal',
    deletedAt,
    messages: [
      { role: 'user', content: '原文' },
      { role: 'assistant', content: '回答' },
    ],
    attachments: [
      {
        id: 'asset',
        name: 'a.txt',
        type: 'text/plain',
        url: 'data:text/plain;base64,aGk=',
      },
    ],
  }));
  w.notes = [
    {
      id: 'n',
      title: 'Note',
      body: '正文',
      source: 'manual',
      editor: '我',
      star: true,
      status: 'trash',
      deletedAt,
      createdAt: deletedAt,
      updatedAt: deletedAt,
      versions: [{ title: '旧标题', body: '旧正文', time: deletedAt }],
    },
  ];
  w.summaries = [
    {
      id: 's',
      title: '摘要',
      text: '保留的历史摘要',
      covered: ['before', 'removed'],
      createdAt: deletedAt,
    },
  ];
  w.watermark = 'removed';
  w.activeId = 's';
  w.blocks = [{ id: 'b', type: 'stars', custom: true, noteIds: ['n'] }];
  return {
    schemaVersion: 1,
    workspaces: [w],
    uploads: [],
    deliveryReceipts: ['old-receipt'],
  };
}
void test('fresh storage starts empty while existing notebooks remain intact', async () => {
  const repo = createIndexedDbRepository(new IDBFactory());
  const session = createPersistentSession(
    'hub-state-v1',
    createEmptyHubState(),
    repo,
    normalizeHubState,
  );
  await session.load();
  assert.deepEqual(session.getSnapshot().value.workspaces, []);
  await repo.write([{ key: 'hub-state-v1', value: fixture() }]);
  const reopened = createPersistentSession(
    'hub-state-v1',
    createEmptyHubState(),
    repo,
    normalizeHubState,
  );
  await reopened.load();
  assert.equal(reopened.getSnapshot().value.workspaces[0].name, '自己的手账');
});
void test('backup round trips complete turns, local attachment bytes, Note versions and drafts', async () => {
  const repo = createIndexedDbRepository(new IDBFactory());
  await repo.write([
    { key: 'hub-state-v1', value: fixture() },
    { key: 'note-draft-w-n', value: { title: '草稿', body: '未提交' } },
  ]);
  const backup = parseBackup(JSON.stringify(await createBackup(repo)));
  assert.deepEqual(backupState(backup), fixture());
  assert.deepEqual(
    backup.entries.find((e) => e.key === 'note-draft-w-n')?.value,
    { title: '草稿', body: '未提交' },
  );
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 9 })));
  assert.throws(() =>
    parseBackup(
      JSON.stringify({
        ...backup,
        entries: [...backup.entries, backup.entries[0]],
      }),
    ),
  );
  const damaged = structuredClone(backup);
  (
    damaged.entries.find((e) => e.key === 'hub-state-v1')!.value as HubState
  ).workspaces[0].notes[0].versions = [null] as never;
  assert.throws(() => parseBackup(JSON.stringify(damaged)));
  for (const entry of [
    { key: 'turn-draft-w-after', value: { messages: [null] } },
    { key: 'model-probes-v2-w', value: [null] },
    { key: 'model-draft-w', value: { promptBlocks: [{ id: 'broken' }] } },
  ])
    assert.throws(() =>
      parseBackup(
        JSON.stringify({ ...backup, entries: [...backup.entries, entry] }),
      ),
    );
  assert.deepEqual(await repo.read('hub-state-v1'), fixture());
});
void test('restore is atomic and old tabs cannot overwrite the restored database', async () => {
  const factory = new IDBFactory();
  const repo = createIndexedDbRepository(factory);
  const stale = createIndexedDbRepository(factory);
  await repo.write([{ key: 'hub-state-v1', value: fixture() }]);
  const backup = await createBackup(repo);
  await stale.read('hub-state-v1');
  await repo.write([
    {
      key: 'hub-state-v1',
      value: { ...fixture(), deliveryReceipts: ['new-receipt'] },
    },
  ]);
  await restoreBackup(repo, backup, new Date(at).toISOString());
  await assert.rejects(
    () => stale.write([{ key: 'hub-state-v1', value: createEmptyHubState() }]),
    /刷新/,
  );
  await assert.rejects(
    () => repo.write([{ key: 'hub-state-v1', value: createEmptyHubState() }]),
    /刷新/,
  );
  const fresh = createIndexedDbRepository(factory);
  const restored = (await fresh.read('hub-state-v1')) as HubState;
  assert.equal(restored.workspaces[0].config.auto, false);
  assert.deepEqual(
    new Set(restored.deliveryReceipts),
    new Set(['old-receipt', 'new-receipt']),
  );
  assert.deepEqual(await fresh.read('delivery-connection-v1'), {
    connected: false,
  });
  assert.equal(purgeTrash(restored, 'expired', at).count, 0);
});
void test('a failed restore rolls back the clear and leaves the repository usable', async () => {
  const repo = createIndexedDbRepository(new IDBFactory());
  await repo.write([{ key: 'hub-state-v1', value: fixture() }]);
  await assert.rejects(() =>
    repo.replace(() => [{ key: 'invalid', value: () => {} }]),
  );
  assert.deepEqual(await repo.read('hub-state-v1'), fixture());
  await repo.write([{ key: 'draft', value: { ok: true } }]);
  assert.deepEqual(await repo.read('draft'), { ok: true });
});
void test('expiry respects 30 days and preserves missing, invalid, future and non-trash dates', () => {
  assert.equal(expiredTrash({ status: 'trash', deletedAt }, at), true);
  assert.equal(expiredTrash({ status: 'trash', deletedAt }, at - 1), false);
  for (const value of [undefined, 'invalid', new Date(at + 1).toISOString()])
    assert.equal(
      expiredTrash({ status: 'trash', deletedAt: value }, at),
      false,
    );
  assert.equal(expiredTrash({ status: 'deprecated', deletedAt }, at), false);
});
void test('purging removes associated drafts and repairs watermark and references atomically', async () => {
  const original = fixture();
  const plan = purgeTrash(original, 'expired', at);
  assert.equal(plan.count, 2);
  assert.equal(plan.state.workspaces[0].watermark, 'before');
  assert.deepEqual(plan.state.workspaces[0].summaries[0].covered, ['before']);
  assert.deepEqual(plan.state.workspaces[0].blocks[0].noteIds, []);
  assert.equal(original.workspaces[0].turns.length, 3);
  const repo = createIndexedDbRepository(new IDBFactory());
  await repo.write([
    { key: 'hub-state-v1', value: original },
    { key: 'note-draft-w-n', value: { body: '私有草稿' } },
    { key: 'turn-draft-w-removed', value: { messages: [] } },
  ]);
  const session = createPersistentSession(
    'hub-state-v1',
    createEmptyHubState(),
    repo,
    normalizeHubState,
  );
  await session.load();
  assert.equal(
    await session.transact((current) => {
      const result = purgeTrash(current, 'all', at);
      return { value: result.state, companions: result.drafts };
    }),
    true,
  );
  assert.equal(await repo.read('note-draft-w-n'), undefined);
  assert.equal(await repo.read('turn-draft-w-removed'), undefined);
  assert.equal(
    ((await repo.read('hub-state-v1')) as HubState).workspaces[0].notes.length,
    0,
  );
});
void test('a failed cleanup preserves both the deleted records and their drafts', async () => {
  const repo = createIndexedDbRepository(new IDBFactory());
  const original = fixture();
  await repo.write([
    { key: 'hub-state-v1', value: original },
    { key: 'note-draft-w-n', value: { body: '保留草稿' } },
  ]);
  const session = createPersistentSession(
    'hub-state-v1',
    createEmptyHubState(),
    repo,
    normalizeHubState,
  );
  await session.load();
  const result = await session.transact((current) => {
    const plan = purgeTrash(current, 'all', at);
    return {
      value: plan.state,
      companions: [...plan.drafts, { key: 'invalid', value: () => {} }],
    };
  });
  assert.equal(result, false);
  assert.deepEqual(session.getSnapshot().value, original);
  assert.deepEqual(await repo.read('hub-state-v1'), original);
  assert.deepEqual(await repo.read('note-draft-w-n'), { body: '保留草稿' });
});
