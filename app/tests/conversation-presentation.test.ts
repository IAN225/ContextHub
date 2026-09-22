import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationGroups } from '../lib/conversation/presentation.ts';
import { messageMedia } from '../lib/attachments/message-media.ts';
import type { Turn } from '../lib/core/model.ts';

test('assistant text and tool activity stay ordered under one assistant heading', () => {
  const roles = [
    'user',
    'assistant',
    'tool_call',
    'tool_result',
    'assistant',
    'tool_use',
    'tool',
    'assistant',
    'user',
    'assistant',
  ];
  assert.deepEqual(
    conversationGroups(roles.map((role) => ({ role, content: role }))),
    [
      { role: 'user', indices: [0] },
      { role: 'assistant', indices: [1, 2, 3, 4, 5, 6, 7] },
      { role: 'user', indices: [8] },
      { role: 'assistant', indices: [9] },
    ],
  );
});

test('tool-first imports receive an assistant heading without merging across other speakers', () => {
  const roles = [
    'tool_call',
    'tool_result',
    'assistant',
    'system',
    'assistant',
    'user',
    'user',
  ];
  assert.deepEqual(
    conversationGroups(roles.map((role) => ({ role, content: '' }))),
    [
      { role: 'assistant', indices: [0, 1, 2] },
      { role: 'system', indices: [3] },
      { role: 'assistant', indices: [4] },
      { role: 'user', indices: [5] },
      { role: 'user', indices: [6] },
    ],
  );
  assert.deepEqual(conversationGroups([]), []);
});

test('grouping preserves attachment indexes and does not mutate the source payload', () => {
  const turn: Turn = {
    id: 't',
    status: 'normal',
    source: 'Claude',
    time: null,
    messages: [
      { role: 'user', content: 'question' },
      { role: 'tool_result', content: 'image', attachmentIds: ['image'] },
      { role: 'assistant', content: 'answer' },
    ],
    attachments: [
      {
        id: 'image',
        name: 'image.png',
        type: 'image/png',
        url: 'data:image/png;base64,aA==',
      },
    ],
  };
  const original = structuredClone(turn);
  const media = messageMedia(turn);
  const groups = conversationGroups(media.messages);
  assert.deepEqual(
    groups.flatMap((group) => group.indices),
    [0, 1, 2],
  );
  assert.equal(media.byMessage[groups[1].indices[0]][0].id, 'image');
  assert.deepEqual(turn, original);
});
