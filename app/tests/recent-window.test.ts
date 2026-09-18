import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Turn } from '../lib/core/model.ts';
import type { McpRepository } from '../lib/mcp/server/repository.ts';
import { callMcpTool } from '../lib/mcp/server/tools.ts';
import { mcpWorkspace } from '../lib/mcp/snapshot.ts';
import { memoryText } from '../lib/memory/compose.ts';
import { coverage } from '../lib/summary/coverage.ts';
import { emptyRemeTrack, summaryWorkspace } from '../lib/summary/engines.ts';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
} from '../lib/summary/planning.ts';
import { estimateTurnTokens } from '../lib/transcript/tokens.ts';
import { groupTurns } from '../lib/transcript/turns.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
function fixture() {
  const w = blankWorkspace('Recent window');
  w.turns = groupTurns(
    Array.from({ length: 12 }, (_, i) => [
      { role: 'user', content: 'REQUEST_' + String(i + 1).padStart(2, '0') },
      {
        role: 'assistant',
        content: 'ANSWER_' + String(i + 1).padStart(2, '0'),
      },
    ]).flat(),
  );
  w.retainMode = 'turns';
  w.retain = 6;
  w.config = { ...w.config, configured: true, modelEnabled: true, batch: 3 };
  return w;
}
const ids = (turns: Turn[]) => turns.map((t) => t.id);
test('12 turns with no summary retain 7–12 and queue 1–6 in chronological order', () => {
  const w = fixture(),
    c = coverage(w);
  assert.equal(c.covered.length, 0);
  assert.deepEqual(ids(c.recent), ids(w.turns.slice(6)));
  assert.deepEqual(ids(c.queued), ids(w.turns.slice(0, 6)));
  assert.deepEqual(ids(c.pending), ids(w.turns.slice(0, 6)));
  assert.deepEqual(planCompression(w)!.turnIds, ids(w.turns.slice(0, 3)));
  const content = memoryText(w, [{ id: 'recent', type: 'recent' }]);
  assert.ok(content.includes('REQUEST_07'));
  assert.ok(content.includes('ANSWER_12'));
  assert.ok(!content.includes('REQUEST_01'));
  assert.ok(!content.includes('ANSWER_06'));
  assert.ok(content.indexOf('REQUEST_07') < content.indexOf('REQUEST_12'));
});
test('batch advancement changes summary coverage without moving the recent window to older turns', () => {
  let w = fixture();
  const recent = ids(w.turns.slice(6));
  for (let batch = 0; batch < 2; batch++) {
    const plan = planCompression(w)!;
    w = applyGeneratedCheckpoint(
      w,
      checkpointFromResult(
        plan,
        { text: 'Summary ' + batch, model: 'test', protocol: 'openai' },
        's' + batch,
        '2026-09-16',
      ),
    );
    const c = coverage(w);
    assert.deepEqual(ids(c.recent), recent);
    assert.equal(c.covered.length, (batch + 1) * 3);
    assert.equal(c.queued.length, 6 - (batch + 1) * 3);
    assert.ok(c.pending.every((t) => !recent.includes(t.id)));
  }
  assert.equal(planCompression(w), null);
  assert.equal(coverage(w).gap.length, 0);
});
test('token windows walk backwards, preserve whole turns and stop at an oversized latest turn', () => {
  const w = fixture();
  w.retainMode = 'tokens';
  w.retainTokens = w.turns
    .slice(-2)
    .reduce((n, t) => n + estimateTurnTokens(t), 0);
  assert.deepEqual(ids(coverage(w).recent), ids(w.turns.slice(-2)));
  w.turns.at(-1)!.messages[0].content = 'long text '.repeat(3000);
  assert.equal(coverage(w).recent.length, 0);
  assert.equal(coverage(w).pending.length, 12);
});
test('inactive turns are skipped and a custom raw-text block selects its own latest suffix', () => {
  const w = fixture();
  w.turns[11].status = 'trash';
  w.turns[10].status = 'deprecated';
  w.retain = 3;
  assert.deepEqual(ids(coverage(w).recent), ids(w.turns.slice(7, 10)));
  const content = memoryText(w, [
    { id: 'tail', type: 'recent', custom: true, windowLength: 2 },
  ]);
  assert.ok(content.includes('REQUEST_09'));
  assert.ok(content.includes('ANSWER_10'));
  for (const n of ['08', '11', '12'])
    assert.ok(!content.includes('REQUEST_' + n));
});
test('both engines and MCP injection use the same latest window as coverage before any compression', async () => {
  const w = fixture();
  w.reme = { ...emptyRemeTrack(), retainMode: 'turns', retain: 2 };
  w.memoryEngine = 'reme';
  const token = {
    id: 'test',
    owner_id: 'owner',
    workspace_id: w.id,
    name: 'test',
    secret_hash: 'unused',
    created_at: 0,
    expires_at: Date.now() + 60000,
    revoked_at: null,
  };
  const repo = {
    read: async () => ({ workspace: mcpWorkspace(w), syncedAt: 'now' }),
  } as unknown as McpRepository;
  for (const engine of ['custom', 'reme'] as const) {
    const result = (await callMcpTool(repo, token, 'memory_bootstrap', {
      engine,
    })) as {
      content: string;
      recentTurnIds: string[];
      omittedTurnIds: string[];
    };
    const c = coverage(summaryWorkspace(w, engine));
    assert.deepEqual(
      result.recentTurnIds,
      ids(w.turns.slice(engine === 'custom' ? -6 : -2)),
    );
    assert.deepEqual(result.recentTurnIds, ids(c.recent));
    assert.deepEqual(result.omittedTurnIds, ids(c.queued));
    assert.ok(result.content.includes('ANSWER_12'));
    assert.ok(!result.content.includes('REQUEST_01'));
  }
});
