import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankWorkspace,
  memoryText,
  type Note,
  type Turn,
} from '../lib/domain.ts';
import {
  applyHubCommand,
  normalizeHubState,
  type HubState,
} from '../lib/hub-state.ts';
function fixture(): HubState {
  const a = blankWorkspace('A');
  a.id = 'a';
  const b = blankWorkspace('B');
  b.id = 'b';
  return { schemaVersion: 1, workspaces: [a, b], uploads: [] };
}
const turn: Turn = {
  id: 'original',
  title: 'whole turn',
  source: 'import',
  time: null,
  status: 'normal',
  messages: [
    { role: 'user', content: 'question' },
    { role: 'assistant', content: 'response' },
    { role: 'tool', content: 'tool result' },
  ],
};
const note: Note = {
  id: 'note',
  title: 'old',
  body: 'old body',
  editor: 'me',
  source: 'manual',
  createdAt: 't0',
  updatedAt: 't0',
  star: false,
  status: 'normal',
  versions: [],
};
void test('commands apply to the latest named workspace without replacing unrelated fields', () => {
  const initial = fixture();
  let state = applyHubCommand(initial, {
    type: 'workspace',
    workspaceId: 'a',
    command: { type: 'workspace/rename', name: 'Renamed' },
  });
  state = applyHubCommand(state, {
    type: 'workspace',
    workspaceId: 'a',
    command: {
      type: 'memory/set',
      blocks: [{ id: 'm', type: 'text', text: 'custom' }],
    },
  });
  state = applyHubCommand(state, {
    type: 'workspace',
    workspaceId: 'b',
    command: { type: 'summary/retain', retain: 3 },
  });
  assert.equal(state.workspaces[0].name, 'Renamed');
  assert.equal(state.workspaces[0].retain, 6);
  assert.equal(memoryText(state.workspaces[0]), 'custom');
  assert.equal(state.workspaces[1].retain, 3);
  assert.equal(initial.workspaces[0].name, 'A');
});
void test('archiving preserves whole turns, assigns new IDs, and consumes a delivery only once', () => {
  const initial = fixture();
  initial.uploads.push({
    id: 'u',
    title: 'delivery',
    source: '/v1/messages',
    kind: 'conversation',
    createdAt: '',
    turns: [turn],
  });
  const command = {
    type: 'upload/archive' as const,
    uploadId: 'u',
    target: 'b',
    batchId: 'imported',
  };
  const state = applyHubCommand(initial, command);
  assert.equal(state.uploads.length, 0);
  assert.deepEqual(state.workspaces[1].turns[0].messages, turn.messages);
  assert.notEqual(state.workspaces[1].turns[0].id, turn.id);
  assert.equal(applyHubCommand(state, command), state);
  assert.throws(() =>
    applyHubCommand(initial, { ...command, target: 'missing' }),
  );
  assert.equal(initial.uploads.length, 1);
});
void test('a candidate uses the latest source workspace and preserves keep/rewind watermarks', () => {
  const initial = fixture();
  initial.workspaces[0].turns = [turn, { ...turn, id: 'second' }];
  initial.workspaces[0].watermark = 'second';
  initial.uploads = [
    {
      id: 'candidate',
      title: 'candidate',
      kind: 'summary',
      source: 'workbench',
      createdAt: '',
      turns: [],
      workspaceId: 'a',
      covered: ['original'],
      summaryText: 'summary',
    },
  ];
  const command = {
    type: 'upload/summary' as const,
    uploadId: 'candidate',
    workspaceId: 'a',
    mode: 'keep' as const,
    at: 'now',
  };
  assert.equal(
    applyHubCommand(initial, command).workspaces[0].watermark,
    'second',
  );
  assert.equal(
    applyHubCommand(initial, { ...command, mode: 'rewind' }).workspaces[0]
      .watermark,
    'original',
  );
  assert.throws(() =>
    applyHubCommand(initial, { ...command, workspaceId: 'b' }),
  );
  assert.equal(initial.uploads.length, 1);
});
void test('Note content saves preserve latest star/status and maintain five versions', () => {
  const initial = fixture();
  initial.workspaces[0].notes = [note];
  let state = applyHubCommand(initial, {
    type: 'workspace',
    workspaceId: 'a',
    command: { type: 'note/star', noteId: 'note', at: 't1' },
  });
  for (let i = 0; i < 7; i++)
    state = applyHubCommand(state, {
      type: 'workspace',
      workspaceId: 'a',
      command: {
        type: 'note/save',
        noteId: 'note',
        title: `version ${i}`,
        body: `body ${i}`,
        editor: 'me',
        at: `t${i + 2}`,
      },
    });
  const saved = state.workspaces[0].notes[0];
  assert.equal(saved.star, true);
  assert.equal(saved.versions.length, 5);
  assert.equal(saved.versions[0].title, 'version 5');
  state = applyHubCommand(state, {
    type: 'workspace',
    workspaceId: 'a',
    command: {
      type: 'note/status',
      noteId: 'note',
      status: 'trash',
      at: 'deleted',
    },
  });
  assert.equal(state.workspaces[0].notes[0].deletedAt, 'deleted');
  assert.ok(!memoryText(state.workspaces[0]).includes('note ·'));
});
void test('editing a turn does not resurrect its newer trash status', () => {
  const initial = fixture();
  initial.workspaces[0].turns = [turn];
  const state = applyHubCommand(initial, {
    type: 'workspace',
    workspaceId: 'a',
    command: {
      type: 'turn/status',
      turnId: turn.id,
      status: 'trash',
      at: 'now',
    },
  });
  const saved = applyHubCommand(state, {
    type: 'workspace',
    workspaceId: 'a',
    command: {
      type: 'turn/save',
      turn: { ...turn, title: 'edited' },
      insert: false,
      afterId: null,
    },
  });
  assert.equal(saved.workspaces[0].turns[0].status, 'trash');
  assert.equal(saved.workspaces[0].turns[0].title, 'edited');
  assert.deepEqual(saved.workspaces[0].turns[0].messages, turn.messages);
});
void test('legacy loading preserves drafts, custom blocks, extras and channel ownership', () => {
  const current = fixture();
  const { schemaVersion: _version, ...old } = current;
  old.workspaces[0].started = true;
  delete old.workspaces[0].firstComplete;
  old.workspaces[0].blocks = [
    { id: 'custom', type: 'summary', custom: true, text: '' },
  ];
  old.uploads = [
    {
      id: 'legacy',
      kind: 'conversation',
      source: '/v1/responses',
      title: 'API',
      createdAt: '',
      turns: [],
    },
  ];
  const raw = { ...old, futureExtra: { preserved: true } };
  const migrated = normalizeHubState(raw);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.workspaces[0].firstComplete, true);
  assert.equal(migrated.uploads[0].channel, 'api');
  assert.equal(memoryText(migrated.workspaces[0]), '[自定义摘要]\n');
  assert.deepEqual(
    (migrated as unknown as typeof raw).futureExtra,
    raw.futureExtra,
  );
  assert.equal(normalizeHubState(migrated), migrated);
  assert.equal(old.uploads[0].channel, undefined);
});
void test('future versions and damaged state cannot be migrated into writable seed data', () => {
  assert.throws(() => normalizeHubState({ ...fixture(), schemaVersion: 999 }));
  assert.deepEqual(
    normalizeHubState({ workspaces: [], uploads: [] }).workspaces,
    [],
  );
  const damaged = fixture();
  (damaged.workspaces[0] as unknown as { turns: unknown }).turns = null;
  assert.throws(() => normalizeHubState(damaged));
});
