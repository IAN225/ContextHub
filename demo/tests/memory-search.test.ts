import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemorySearch } from '../lib/memory-search.ts';
import { blankWorkspace, type Workspace } from '../lib/domain.ts';
import { applyWorkspaceCommand } from '../lib/hub-state.ts';

const options = { query: 'needle', scope: 'all', kind: 'all', limit: 20 };
function fixture(): Workspace {
  const w = blankWorkspace('Search workspace');
  return {
    ...w,
    turns: [
      {
        id: 'turn-1',
        title: 'Needle',
        source: 'test',
        time: null,
        status: 'normal',
        messages: [
          { role: 'user', content: 'question' },
          { role: 'tool', content: 'complete tool result' },
        ],
      },
      {
        id: 'turn-2',
        title: 'Needle',
        source: 'test',
        time: null,
        messages: [],
        status: 'deprecated',
      },
    ],
    summaries: [
      {
        id: 'summary',
        title: 'needle summary',
        text: 'summary',
        covered: [],
        createdAt: '2026-09-09',
      },
    ],
    notes: ['normal', 'trash'].map((status, i) => ({
      id: `note-${i}`,
      title: 'needle Note',
      body: 'body',
      status: status as 'normal' | 'trash',
      star: false,
      source: 'test',
      editor: 'me',
      createdAt: '2026-09-09',
      updatedAt: '2026-09-09',
      versions: [],
    })),
  };
}
void test('search counts all matches, limits returned items and preserves full turn/tool content', () => {
  const search = createMemorySearch();
  const result = search([fixture()], {
    ...options,
    query: ' NEEDLE ',
    limit: 1,
  });
  assert.equal(result.total, 3);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].kind, 'turn');
  assert.equal(
    result.items[0].text,
    'user: question\n\ntool: complete tool result',
  );
  assert.deepEqual(search([fixture()], { ...options, query: '  ' }), {
    total: 0,
    items: [],
  });
});
void test('scope and type select current workspace names and exclude inactive source content', () => {
  const search = createMemorySearch();
  const a = fixture();
  const b = { ...fixture(), id: 'second', name: a.name };
  const result = search([a, b], { ...options, scope: b.id, kind: 'note' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].workspaceId, b.id);
  assert.equal(
    search([{ ...b, name: 'renamed' }], options).items[0].workspace,
    'renamed',
  );
});
void test('subsequent searches see edited content and trash status while retaining unrelated source results', () => {
  const search = createMemorySearch();
  const w = fixture();
  assert.equal(search([w], options).total, 3);
  const removed = applyWorkspaceCommand(w, {
    type: 'turn/status',
    turnId: 'turn-1',
    status: 'trash',
    at: '2026-09-09T00:00:00Z',
  });
  assert.equal(search([removed], options).total, 2);
  const edited = {
    ...removed,
    notes: removed.notes.map((n) => ({
      ...n,
      title: 'changed',
      body: 'different content',
    })),
  };
  assert.equal(search([edited], options).total, 1);
  assert.equal(search([w], options).total, 3);
});
