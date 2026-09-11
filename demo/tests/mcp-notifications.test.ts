import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace, type Note } from '../lib/domain.ts';
import {
  applyHubCommand,
  normalizeHubState,
  type HubState,
} from '../lib/hub-state.ts';
import { validateBackup } from '../lib/backup.ts';
import type { McpEvent } from '../lib/mcp/contracts.ts';

void test('MCP creates one durable inbox notification per creation in the correct workspace', () => {
  const first = blankWorkspace('日常');
  const second = blankWorkspace('研究');
  const note: Note = {
    id: 'model-note',
    title: '研究记录',
    body: '内容',
    star: true,
    status: 'normal',
    createdAt: '2026-09-11T09:00:00.000Z',
    updatedAt: '2026-09-11T09:00:00.000Z',
    editor: 'Claude · OAuth',
    source: 'MCP',
    versions: [],
  };
  const created: McpEvent = {
    id: 'created-once',
    kind: 'note',
    before: null,
    note,
  };
  const command = {
    type: 'mcp/receive' as const,
    workspaceId: second.id,
    events: [created, created],
  };
  let state: HubState = {
    schemaVersion: 1,
    workspaces: [first, second],
    uploads: [],
  };
  state = applyHubCommand(state, command);
  assert.equal(state.workspaces[0].notes.length, 0);
  assert.equal(state.workspaces[1].notes.length, 1);
  assert.deepEqual(state.noteNotifications, [
    {
      id: created.id,
      workspaceId: second.id,
      workspaceName: '研究',
      noteId: note.id,
      title: note.title,
      clientName: note.editor,
      createdAt: note.createdAt,
      read: false,
    },
  ]);
  assert.equal(applyHubCommand(state, command), state);
  state = applyHubCommand(state, {
    type: 'notification/read',
    notificationId: created.id,
  });
  state = normalizeHubState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.noteNotifications?.[0].read, true);
  assert.equal(applyHubCommand(state, command), state);
  const changed = { ...note, title: '更新后的记录', body: '改动' };
  state = applyHubCommand(state, {
    ...command,
    events: [{ id: 'replace', kind: 'note', before: note, note: changed }],
  });
  assert.equal(state.noteNotifications?.length, 1);
  assert.equal(state.noteNotifications?.[0].title, '研究记录');
  assert.equal(state.workspaces[1].notes[0].title, changed.title);
  const backup = validateBackup({
    format: 'context-hub-backup',
    version: 1,
    createdAt: note.createdAt,
    entries: [{ key: 'hub-state-v1', value: state }],
  });
  assert.deepEqual(
    (backup.entries[0].value as HubState).noteNotifications,
    state.noteNotifications,
  );
  assert.throws(() =>
    normalizeHubState({
      ...state,
      noteNotifications: [{ ...state.noteNotifications![0], read: 'yes' }],
    }),
  );
});

void test('manual creation and already received MCP events do not generate mail', () => {
  const workspace = blankWorkspace('日常');
  const note: Note = {
    id: 'manual',
    title: '手写',
    body: '',
    star: false,
    status: 'normal',
    createdAt: '2026-09-11',
    updatedAt: '2026-09-11',
    editor: '我',
    source: 'manual',
    versions: [],
  };
  let state: HubState = {
    schemaVersion: 1,
    workspaces: [workspace],
    uploads: [],
    mcpReceipts: ['already-received'],
  };
  state = applyHubCommand(state, {
    type: 'workspace',
    workspaceId: workspace.id,
    command: { type: 'note/create', note },
  });
  state = applyHubCommand(state, {
    type: 'mcp/receive',
    workspaceId: workspace.id,
    events: [{ id: 'already-received', kind: 'note', before: null, note }],
  });
  assert.equal(state.noteNotifications?.length ?? 0, 0);
  assert.equal(state.workspaces[0].notes.length, 1);
});
