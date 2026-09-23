import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBackup,
  parseBackup,
  backupState,
} from '../lib/storage/backup.ts';
import {
  importBackupWorkspaces,
  selectBackupWorkspaces,
} from '../lib/storage/workspace-backup.ts';
import { createEntityRepository } from '../lib/storage/repository.ts';
import type {
  DataRepository,
  StorageEntry,
} from '../lib/storage/account-repository.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import type { HubState } from '../lib/state/contracts.ts';

function memory() {
  let entries: StorageEntry[] = [];
  let replacements = 0;
  const store: DataRepository = {
    read: async (key) =>
      structuredClone(entries.find((e) => e.key === key)?.value),
    entries: async () => structuredClone(entries),
    write: async (values) => {
      for (const entry of values)
        entries = [
          ...entries.filter((e) => e.key !== entry.key),
          structuredClone(entry),
        ];
    },
    replace: async (transform) => {
      replacements++;
      entries = structuredClone(transform(entries));
    },
  };
  return {
    repository: createEntityRepository(store),
    replacements: () => replacements,
  };
}
async function fixture() {
  const { repository } = memory();
  const workspaces = ['a', 'a-other', 'c', 'd', 'e'].map((id) => {
    const w = blankWorkspace(id);
    w.id = id;
    w.config.auto = true;
    w.config.configured = true;
    w.turns = [
      {
        id: 'turn',
        source: 'test',
        time: null,
        status: 'normal',
        messages: [
          { role: 'user', content: `only-${id}`, attachmentIds: ['image'] },
        ],
        attachments: [
          {
            id: 'image',
            name: 'image.png',
            type: 'image/png',
            url: 'data:image/png;base64,aA==',
          },
        ],
      },
    ];
    w.notes = [
      {
        id: 'note',
        title: id,
        body: 'note-body',
        star: true,
        status: 'normal',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        editor: 'user',
        source: 'test',
        versions: [],
      },
    ];
    w.summaries = [
      {
        id: 'summary',
        title: 'summary',
        text: 'summary-body',
        covered: ['turn'],
        createdAt: '2026-01-01',
      },
    ];
    w.activeId = 'summary';
    w.watermark = 'turn';
    w.blocks.push({ id: 'selected-notes', type: 'stars', noteIds: ['note'] });
    return w;
  });
  const state: HubState = {
    schemaVersion: 1,
    workspaces,
    uploads: [
      ...workspaces.map((w) => ({
        id: 'upload-' + w.id,
        title: 'candidate',
        source: 'test',
        turns: [],
        kind: 'summary' as const,
        createdAt: '2026-01-01',
        workspaceId: w.id,
        covered: ['turn'],
        summaryText: 'candidate',
      })),
      {
        id: 'unassigned',
        title: 'private-inbox',
        source: 'test',
        turns: [],
        kind: 'conversation',
        createdAt: '2026-01-01',
      },
    ],
    deliveryReceipts: ['private-receipt'],
    noteNotifications: workspaces.map((w) => ({
      id: 'notification-' + w.id,
      workspaceId: w.id,
      workspaceName: w.name,
      noteId: 'note',
      title: w.name,
      clientName: 'Claude',
      createdAt: '2026-01-01',
      read: false,
    })),
  };
  await repository.write([
    { key: 'hub-state-v1', value: state },
    { key: 'search-draft', value: { query: 'private-query' } },
    ...workspaces.flatMap((w) => [
      { key: `note-draft-${w.id}-note`, value: { body: 'draft-' + w.id } },
      {
        key: `model-draft-${w.id}-reme`,
        value: { auto: true, configured: true },
      },
      {
        key: `turn-draft-${w.id}-start`,
        value: {
          messages: [{ role: 'user', content: 'draft-' + w.id }],
          attachments: w.turns[0].attachments,
        },
      },
    ]),
  ]);
  return { backup: await createBackup(repository), state };
}
test('five workspaces export three, then import one with its complete dependencies', async () => {
  const { backup } = await fixture();
  const before = JSON.stringify(backup);
  const exported = parseBackup(
    JSON.stringify(selectBackupWorkspaces(backup, ['a', 'c', 'e'])),
  );
  assert.deepEqual(
    backupState(exported).workspaces.map((w) => w.id),
    ['a', 'c', 'e'],
  );
  assert.equal(
    exported.entries.some((e) => e.key === 'search-draft'),
    false,
  );
  assert.equal(JSON.stringify(exported).includes('a-other'), false);
  assert.equal(JSON.stringify(exported).includes('private-'), false);
  assert.equal(backupState(exported).uploads.length, 3);
  const target = memory();
  await importBackupWorkspaces(target.repository, exported, ['c']);
  const result = (await target.repository.read('hub-state-v1')) as HubState;
  assert.equal(result.workspaces.length, 1);
  const w = result.workspaces[0];
  assert.equal(w.name, 'c');
  assert.notEqual(w.id, 'c');
  assert.equal(w.turns[0].attachments?.[0].url, 'data:image/png;base64,aA==');
  assert.equal(w.summaries[0].covered[0], w.turns[0].id);
  assert.equal(w.activeId, w.summaries[0].id);
  assert.equal(w.blocks.at(-1)?.noteIds?.[0], w.notes[0].id);
  assert.equal(result.uploads[0].workspaceId, w.id);
  assert.equal(result.noteNotifications?.[0].workspaceId, w.id);
  assert.equal(
    (
      (await target.repository.read(`note-draft-${w.id}-note`)) as {
        body: string;
      }
    ).body,
    'draft-c',
  );
  assert.equal(
    (
      (await target.repository.read(`model-draft-${w.id}-reme`)) as {
        auto: boolean;
      }
    ).auto,
    false,
  );
  assert.equal(w.config.auto, false);
  assert.equal(w.config.configured, false);
  assert.equal(target.replacements(), 0);
  assert.equal(JSON.stringify(backup), before);
});
test('append preserves existing workspaces, preferences, receipts and trash lifetime even for matching IDs', async () => {
  const { backup, state } = await fixture();
  const target = memory();
  state.workspaces[0].turns[0].status = 'trash';
  state.workspaces[0].turns[0].deletedAt = '2020-01-01';
  await target.repository.write([
    { key: 'hub-state-v1', value: state },
    { key: 'search-draft', value: { query: 'keep' } },
    { key: 'delivery-connection-v1', value: { connected: true } },
  ]);
  const prior = (await target.repository.read('hub-state-v1')) as HubState;
  await importBackupWorkspaces(target.repository, backup, ['a']);
  const result = (await target.repository.read('hub-state-v1')) as HubState;
  assert.deepEqual(result.workspaces.slice(0, 5), prior.workspaces);
  assert.equal(result.workspaces.length, 6);
  assert.notEqual(result.workspaces[5].id, 'a');
  assert.deepEqual(result.deliveryReceipts, prior.deliveryReceipts);
  assert.deepEqual(await target.repository.read('search-draft'), {
    query: 'keep',
  });
  assert.deepEqual(await target.repository.read('delivery-connection-v1'), {
    connected: true,
  });
  assert.equal(target.replacements(), 0);
});
test('empty and unknown selections fail before any writes and old backup versions remain selectable', async () => {
  const { backup } = await fixture();
  const target = memory();
  await assert.rejects(
    importBackupWorkspaces(target.repository, backup, []),
    /选择/,
  );
  await assert.rejects(
    importBackupWorkspaces(target.repository, backup, ['missing']),
    /选择/,
  );
  assert.deepEqual(await target.repository.entries(), []);
  const legacy = parseBackup(JSON.stringify({ ...backup, version: 1 }));
  assert.equal(
    backupState(selectBackupWorkspaces(legacy, ['a'])).workspaces.length,
    1,
  );
});
