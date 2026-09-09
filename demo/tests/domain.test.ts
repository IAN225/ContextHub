import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupTurns,
  restoreSummary,
  coverage,
  memoryText,
  uid,
  type Workspace,
} from '../lib/domain.ts';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
} from '../lib/summary/planning.ts';
// Synthetic model text belongs in tests; production never substitutes excerpts.
function compressBatch(w: Workspace) {
  const plan = planCompression(w);
  return plan
    ? applyGeneratedCheckpoint(
        w,
        checkpointFromResult(
          plan,
          { text: 'Test model summary', model: 'test', protocol: 'openai' },
          uid(),
          '2026-09-09',
        ),
      )
    : w;
}

const turns = Array.from({ length: 8 }, (_, i) => ({
  id: `t${i + 1}`,
  title: `对话${i + 1}`,
  messages: [
    { role: 'user', content: `user ${i + 1}` },
    { role: 'assistant', content: `answer ${i + 1}` },
  ],
  status: 'normal' as const,
  source: 'ChatGPT',
  time: null,
}));
const old = {
  id: 's1',
  title: '早期摘要',
  text: '保留交流偏好',
  covered: ['t1', 't2'],
  createdAt: '2026-09-01',
};
const latest = {
  ...old,
  id: 's2',
  covered: ['t1', 't2', 't3', 't4', 't5', 't6'],
};
const workspace = (): Workspace => ({
  id: 'w1',
  name: '日常',
  platform: 'ChatGPT',
  turns: structuredClone(turns),
  summaries: [old, latest],
  activeId: 's2',
  watermark: 't6',
  retain: 2,
  notes: [],
  blocks: [
    { id: 'b1', type: 'summary' },
    { id: 'b2', type: 'recent' },
    { id: 'b3', type: 'stars' },
  ],
  tokens: [],
  config: {
    configured: true,
    modelEnabled: true,
    auto: false,
    batch: 2,
    review: true,
  },
  started: true,
});

void test('工具调用和结果不会被拆离发起轮次，隐藏思考被丢弃', () => {
  const r = groupTurns([
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'tool', content: 'c' },
    { role: 'reasoning', content: 'secret' },
    { role: 'user', content: 'd' },
  ]);
  assert.deepEqual(
    r.map((t) => t.messages.map((m) => m.role)),
    [['user', 'assistant', 'tool'], ['user']],
  );
});
void test('保留水位回退后准确显示中间缺口', () => {
  const w = restoreSummary(workspace(), 's1', 'keep');
  assert.equal(w.watermark, 't6');
  assert.deepEqual(
    coverage(w).gap.map((t) => t.id),
    ['t3', 't4', 't5', 't6'],
  );
  assert.deepEqual(
    coverage(w).recent.map((t) => t.id),
    ['t7', 't8'],
  );
});
void test('跟随回退把早期原文恢复到待压缩范围', () => {
  const w = restoreSummary(workspace(), 's1', 'rewind');
  assert.equal(w.watermark, 't2');
  assert.equal(coverage(w).gap.length, 0);
  assert.deepEqual(
    coverage(w).recent.map((t) => t.id),
    ['t3', 't4'],
  );
  assert.deepEqual(
    coverage(w).pending.map((t) => t.id),
    ['t3', 't4', 't5', 't6'],
  );
});
void test('检查点达到上限后继续压缩仍保留最新活跃摘要', () => {
  const w = restoreSummary(workspace(), 's1', 'rewind');
  w.summaries = Array.from({ length: 30 }, (_, i) => ({ ...old, id: `s${i}` }));
  w.activeId = 's1';
  const next = compressBatch(w);
  assert.equal(next.summaries.length, 30);
  assert.equal(next.summaries.at(-1)?.id, next.activeId);
  assert.equal(next.watermark, 't4');
});
void test('召回不包含弃用原文、回收站笔记，星标只返回 id 列表', () => {
  const w = workspace();
  w.turns[6].status = 'deprecated';
  w.notes = [
    {
      id: 'n1',
      title: '偏好',
      body: '秘密正文',
      star: true,
      status: 'normal',
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      editor: '我',
      source: '测试',
      versions: [],
    },
    {
      id: 'n2',
      title: '已删',
      body: '不可返回',
      star: true,
      status: 'trash',
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      editor: '我',
      source: '测试',
      versions: [],
    },
  ];
  const text = memoryText(w);
  assert.ok(!text.includes('user 7'));
  assert.ok(text.includes('user 8'));
  assert.ok(text.includes('n1'));
  assert.ok(!text.includes('秘密正文'));
  assert.ok(!text.includes('n2'));
});
void test('插入原文后摘要覆盖仍依稳定轮次 ID，缺口不会误标已总结', () => {
  const w = workspace();
  w.turns.splice(1, 0, { ...turns[0], id: 'inserted' });
  assert.equal(coverage(w).gap[0].id, 'inserted');
  assert.equal(coverage(w).covered.length, 6);
});
void test('保留水位分支后只总结水位之后的新轮次', () => {
  const w = restoreSummary(workspace(), 's1', 'keep');
  w.turns.push({ ...turns[0], id: 't9' }, { ...turns[0], id: 't10' });
  const next = compressBatch(w);
  assert.equal(next.watermark, 't8');
  assert.deepEqual(
    coverage(next).gap.map((t) => t.id),
    ['t3', 't4', 't5', 't6'],
  );
  assert.deepEqual(next.summaries.at(-1)?.covered, ['t1', 't2', 't7', 't8']);
  assert.equal(compressBatch(next).summaries.length, next.summaries.length);
});
