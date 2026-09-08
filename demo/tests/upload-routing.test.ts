import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as domain from '../lib/domain.ts';

const upload = (
  id: string,
  patch: Partial<domain.Upload> = {},
): domain.Upload => ({
  id,
  title: id,
  source: '分享链接',
  kind: 'conversation',
  turns: [],
  createdAt: '2026-09-09T00:00:00Z',
  ...patch,
});

void test('API inbox excludes link imports and summary candidates, including older saved items', () => {
  const items = [
    upload('link', { source: 'Claude 分享链接 · 示例' }),
    upload('chat', { source: '/v1/chat/completions' }),
    upload('responses', { source: '/v1/responses' }),
    upload('messages', { source: '/v1/messages' }),
    upload('summary', { kind: 'summary', workspaceId: 'ws-a' }),
  ];
  assert.deepEqual(
    domain.pendingUploads(items, 'api').map((u) => u.id),
    ['chat', 'responses', 'messages'],
  );
  assert.deepEqual(
    domain.pendingUploads(items, 'link').map((u) => u.id),
    ['link'],
  );
});

void test('explicit delivery channel works with a client display name instead of a protocol URL', () => {
  const items = [upload('client', { channel: 'api', source: '我的 Chatbox' })];
  assert.deepEqual(
    domain.pendingUploads(items, 'api').map((u) => u.id),
    ['client'],
  );
});

void test('workbench candidates stay with their original workspace and remain available', () => {
  const items = [
    upload('a', { kind: 'summary', workspaceId: 'ws-a' }),
    upload('b', { kind: 'summary', workspaceId: 'ws-b' }),
    upload('unknown-old-import', { source: '旧版本手动导入' }),
  ];
  assert.deepEqual(
    domain.pendingUploads(items, 'workbench', 'ws-a').map((u) => u.id),
    ['a'],
  );
  assert.deepEqual(
    domain.pendingUploads(items, 'workbench', 'ws-b').map((u) => u.id),
    ['b'],
  );
  assert.deepEqual(
    domain.pendingUploads(items, 'link').map((u) => u.id),
    ['unknown-old-import'],
  );
  assert.equal(items.length, 3);
});
