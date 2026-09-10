import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  blankWorkspace,
  coverage,
  estimateTurnTokens,
  memoryText,
  restoreSummary,
  selectRetentionWindow,
  type Turn,
} from '../lib/domain.ts';
import { applyWorkspaceCommand, normalizeHubState } from '../lib/hub-state.ts';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
  summaryRevision,
} from '../lib/summary/planning.ts';
import { summaryTaskWorkspace } from '../lib/tasks/snapshot.ts';
import { createBackup, parseBackup, backupState } from '../lib/backup.ts';
import { createIndexedDbRepository } from '../lib/repository.ts';

function turn(id: string, size = 20): Turn {
  return {
    id,
    title: id,
    source: 'test',
    time: null,
    status: 'normal',
    messages: [
      { role: 'user', content: id + 'x'.repeat(size) },
      { role: 'assistant', content: 'complete reply' },
      { role: 'tool_result', callId: 'call', content: 'complete tool result' },
    ],
  };
}
function workspace() {
  const w = blankWorkspace('token window');
  w.turns = ['a', 'b', 'c', 'd'].map((id) => turn(id));
  w.retainMode = 'tokens';
  w.retainTokens = estimateTurnTokens(w.turns[0]) * 2;
  w.config = {
    ...w.config,
    configured: true,
    modelEnabled: true,
    batch: 1,
    review: false,
  };
  return w;
}
const ids = (turns: Turn[]) => turns.map((t) => t.id);
void test('token boundaries include only complete contiguous turns, including all tool messages', () => {
  const w = workspace();
  assert.deepEqual(ids(coverage(w).recent), ['a', 'b']);
  assert.deepEqual(ids(coverage(w).pending), ['a', 'b']);
  w.retainTokens!--;
  assert.deepEqual(ids(coverage(w).recent), ['a']);
  assert.deepEqual(ids(coverage(w).pending), ['a', 'b', 'c']);
  assert.equal(coverage(w).recent[0].messages.length, 3);
  assert.ok(memoryText(w).includes('complete tool result'));
  assert.ok(!memoryText(w).includes('b' + 'x'.repeat(20)));
  w.turns = [turn('a'), turn('b', 10000), turn('c')];
  assert.deepEqual(
    ids(coverage(w).recent),
    ['a'],
    'cannot skip a large turn to include a later smaller one',
  );
  assert.deepEqual(ids(selectRetentionWindow(w, w.turns, true)), ['c']);
});
void test('an oversized next or newest turn remains wholly outside its window and can still be compressed', () => {
  const w = workspace();
  w.retainTokens = 1;
  assert.deepEqual(coverage(w).recent, []);
  assert.deepEqual(ids(coverage(w).pending), ['a', 'b', 'c', 'd']);
  const plan = planCompression(w)!;
  assert.deepEqual(plan.turnIds, ['a']);
  assert.ok(plan.input.user.includes('complete tool result'));
  assert.equal(w.turns[0].messages[0].content, 'a' + 'x'.repeat(20));
});
void test('compression and rewind move a token window with the watermark without losing or splitting turns', () => {
  let w = workspace();
  const first = planCompression(w)!;
  w = applyGeneratedCheckpoint(
    w,
    checkpointFromResult(
      first,
      { text: 'first', model: 'test', protocol: 'openai' },
      's1',
      '2026-09-10',
    ),
  );
  assert.equal(w.watermark, 'a');
  assert.deepEqual(ids(coverage(w).recent), ['b', 'c']);
  const second = planCompression(w)!;
  w = applyGeneratedCheckpoint(
    w,
    checkpointFromResult(
      second,
      { text: 'second', model: 'test', protocol: 'openai' },
      's2',
      '2026-09-10',
    ),
  );
  assert.equal(w.watermark, 'b');
  assert.deepEqual(ids(coverage(w).recent), ['c', 'd']);
  assert.equal(planCompression(w), null);
  const rewound = restoreSummary(w, 's1', 'rewind');
  assert.deepEqual(ids(coverage(rewound).recent), ['b', 'c']);
  const keep = restoreSummary(w, 's1', 'keep');
  assert.deepEqual(ids(coverage(keep).gap), ['b']);
  assert.deepEqual(ids(coverage(keep).recent), ['c', 'd']);
});
void test('changing token limits invalidates in-flight summaries; custom memory windows and old data remain count-based', () => {
  const w = workspace();
  const plan = planCompression(w)!;
  const changed = applyWorkspaceCommand(w, {
    type: 'summary/retain',
    tokens: 1,
  });
  assert.throws(
    () =>
      applyGeneratedCheckpoint(
        changed,
        checkpointFromResult(
          plan,
          { text: 'stale', model: 'test', protocol: 'openai' },
          'stale',
          '2026-09-10',
        ),
      ),
    /已经变化/,
  );
  const custom = memoryText(changed, [
    { id: 'custom', type: 'recent', custom: true, windowLength: 2 },
  ]);
  assert.ok(custom.includes('b' + 'x'.repeat(20)));
  assert.ok(!custom.includes('c' + 'x'.repeat(20)));
  const old = { ...w };
  delete old.retainMode;
  delete old.retainTokens;
  old.retain = 2;
  const restored = normalizeHubState({
    schemaVersion: 1,
    workspaces: [old],
    uploads: [],
  }).workspaces[0];
  assert.deepEqual(ids(coverage(restored).recent), ['a', 'b']);
  const back = applyWorkspaceCommand(changed, {
    type: 'summary/retain',
    mode: 'turns',
  });
  assert.equal(back.retain, w.retain);
  assert.equal(back.retainTokens, 1);
});
void test('token counting excludes binary bytes, includes readable attachments, and agrees with the server snapshot', async () => {
  const w = workspace();
  w.turns[0].attachments = [
    {
      id: 'file',
      name: 'facts.txt',
      type: 'text/plain',
      url: 'data:text/plain;base64,YQ==',
      status: 'stored',
      text: '中文附件正文',
    },
  ];
  const count = estimateTurnTokens(w.turns[0]);
  w.turns[0].tokens = 999999999;
  w.turns[0].attachments[0].url += 'A'.repeat(100000);
  assert.equal(estimateTurnTokens(w.turns[0]), count);
  const snapshot = summaryTaskWorkspace(w);
  assert.equal(estimateTurnTokens(snapshot.turns[0]), count);
  assert.equal(summaryRevision(snapshot), summaryRevision(w));
  w.turns[0].attachments = [];
  assert.ok(estimateTurnTokens(w.turns[0]) < count);
  const repo = createIndexedDbRepository(new IDBFactory());
  await repo.write([
    {
      key: 'hub-state-v1',
      value: { schemaVersion: 1, workspaces: [w], uploads: [] },
    },
  ]);
  const restored = backupState(
    parseBackup(JSON.stringify(await createBackup(repo))),
  ).workspaces[0];
  assert.equal(restored.retainMode, 'tokens');
  assert.equal(restored.retainTokens, w.retainTokens);
  assert.deepEqual(ids(coverage(restored).recent), ids(coverage(w).recent));
  const invalid = {
    schemaVersion: 1,
    workspaces: [{ ...w, retainTokens: -1 }],
    uploads: [],
  };
  assert.throws(() => normalizeHubState(invalid));
});
