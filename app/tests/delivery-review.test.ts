import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace, groupTurns, type Upload } from '../lib/domain.ts';
import {
  applyHubCommand,
  createEmptyHubState,
  type HubState,
} from '../lib/hub-state.ts';
import { deliveryTriggerTurn } from '../lib/imports/delivery-review.ts';

function fixture() {
  const upload: Upload = {
    id: 'receipt',
    title: '历史对话',
    kind: 'conversation',
    channel: 'api',
    source: 'Chat Completions',
    createdAt: '2026-09-14',
    turns: groupTurns([
      { role: 'user', content: '原始问题' },
      { role: 'assistant', content: '原始回答' },
      { role: 'user', content: 'hi' },
    ]),
  };
  const workspace = blankWorkspace('归档目标');
  const state: HubState = {
    ...createEmptyHubState(),
    workspaces: [workspace],
    uploads: [upload],
  };
  return { upload, workspace, state };
}
void test('API trailing user message can be excluded atomically while keeping complete history and original receipt', () => {
  const { upload, workspace, state } = fixture();
  const trigger = deliveryTriggerTurn(upload)!;
  const archived = applyHubCommand(state, {
    type: 'upload/archive',
    uploadId: upload.id,
    target: workspace.id,
    batchId: 'archived',
    excludedTriggerId: trigger.id,
  });
  assert.equal(archived.workspaces[0].turns.length, 1);
  assert.deepEqual(
    archived.workspaces[0].turns[0].messages.map((m) => m.content),
    ['原始问题', '原始回答'],
  );
  assert.equal(archived.uploads.length, 0);
  assert.equal(state.uploads[0].turns.length, 2);
  assert.equal(state.workspaces[0].turns.length, 0);
});
void test('opting in keeps the last message; manual, link, answered and attachment turns are never candidates', () => {
  const { upload, workspace, state } = fixture();
  const archived = applyHubCommand(state, {
    type: 'upload/archive',
    uploadId: upload.id,
    target: workspace.id,
    batchId: 'all',
  });
  assert.equal(archived.workspaces[0].turns.length, 2);
  for (const channel of ['manual', 'link'] as const)
    assert.equal(deliveryTriggerTurn({ ...upload, channel }), undefined);
  assert.equal(
    deliveryTriggerTurn({ ...upload, turns: upload.turns.slice(0, 1) }),
    undefined,
  );
  const withAttachment = structuredClone(upload);
  withAttachment.turns[1].messages[0].attachmentIds = ['file'];
  assert.equal(deliveryTriggerTurn(withAttachment), undefined);
  assert.ok(
    deliveryTriggerTurn({
      ...upload,
      channel: undefined,
      source: '/v1/chat/completions',
    }),
  );
});
void test('a stale exclusion cannot delete a changed turn or archive an empty conversation', () => {
  const { upload, workspace, state } = fixture();
  const command = {
    type: 'upload/archive' as const,
    uploadId: upload.id,
    target: workspace.id,
    batchId: 'test',
    excludedTriggerId: upload.turns[1].id,
  };
  const changed = structuredClone(state);
  changed.uploads[0].turns[1].messages.push({
    role: 'assistant',
    content: '新的回答',
  });
  assert.throws(() => applyHubCommand(changed, command), /已变化/);
  const single = {
    ...state,
    uploads: [{ ...upload, turns: upload.turns.slice(-1) }],
  };
  assert.throws(() => applyHubCommand(single, command), /没有可归档/);
  assert.equal(single.uploads.length, 1);
  assert.equal(
    applyHubCommand(single, { ...command, excludedTriggerId: undefined })
      .workspaces[0].turns.length,
    1,
  );
});
