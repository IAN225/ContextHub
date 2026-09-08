import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace, memoryText } from '../lib/domain.ts';
function fixture() {
  const w = blankWorkspace('test', 'test');
  w.summaries = [
    {
      id: 's',
      title: 'summary',
      text: 'source summary',
      covered: [],
      createdAt: '',
    },
  ];
  w.activeId = 's';
  w.turns = Array.from({ length: 4 }, (_, i) => ({
    id: `t${i}`,
    title: '',
    messages: [{ role: 'user', content: `turn ${i}` }],
    status: 'normal' as const,
    source: '',
    time: null,
  }));
  w.retain = 1;
  w.notes = ['a', 'b', 'gone'].map((id) => ({
    id,
    title: id,
    body: 'private body',
    star: id === 'a',
    status: id === 'gone' ? ('trash' as const) : ('normal' as const),
    createdAt: '',
    updatedAt: '',
    editor: '',
    source: '',
    versions: [],
  }));
  return w;
}
void test('custom summary is independent, including an intentionally empty summary', () => {
  const w = fixture();
  const block = {
    id: 'x',
    type: 'summary' as const,
    custom: true,
    text: 'my summary',
  };
  assert.equal(memoryText(w, [block]), '[自定义摘要]\nmy summary');
  w.summaries[0].text = 'updated source';
  assert.equal(memoryText(w, [block]), '[自定义摘要]\nmy summary');
  assert.equal(memoryText(w, [{ ...block, text: '' }]), '[自定义摘要]\n');
  assert.equal(
    memoryText(w, [{ id: 'new', type: 'summary' }]),
    '[当前活跃摘要]\nupdated source',
  );
});
void test('chosen window changes package length without changing workspace retain or splitting turns', () => {
  const w = fixture();
  w.turns[1].status = 'trash';
  const text = memoryText(w, [
    { id: 'x', type: 'recent', custom: true, windowLength: 2 },
  ]);
  assert.equal(text, '[自选滑动窗口]\nuser: turn 0\n\nuser: turn 2');
  assert.equal(w.retain, 1);
  assert.equal(
    memoryText(w, [{ id: 'new', type: 'recent' }]),
    '[近期原文]\nuser: turn 0',
  );
});
void test('chosen note IDs include normal unstarred notes, exclude missing/trash and keep empty selection', () => {
  const w = fixture();
  assert.equal(
    memoryText(w, [
      {
        id: 'x',
        type: 'stars',
        custom: true,
        noteIds: ['b', 'gone', 'missing', 'b'],
      },
    ]),
    '[自选 Note id 列表]\nb · b',
  );
  assert.equal(
    memoryText(w, [{ id: 'x', type: 'stars', custom: true, noteIds: [] }]),
    '[自选 Note id 列表]\n未选择笔记',
  );
  assert.equal(
    memoryText(w, [{ id: 'new', type: 'stars' }]),
    '[标星 Note id 列表]\na · a',
  );
  assert(w.notes[0].star);
});
