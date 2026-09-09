import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importManual } from '../lib/imports/manual.ts';
import { getProtocol } from '../lib/imports/protocols.ts';
import {
  decodeRouterTable,
  parseChatGPTShare,
} from '../lib/imports/parsers/chatgpt-share.ts';
import { parseClaudeShare } from '../lib/imports/parsers/claude-share.ts';
import {
  importShare,
  resolveShareUrl,
} from '../lib/imports/server/share-service.ts';

void test('manual copy preserves whole turns, Markdown, and role-like lines inside fenced code', () => {
  const text =
    '用户：问题\n助手：答案\n```yaml\nuser: this is code\n```\n用户：继续\n助手：第二个答案';
  const result = importManual(text);
  assert.equal(result.channel, 'manual');
  assert.equal(result.turns.length, 2);
  assert.match(result.turns[0].messages[1].content, /user: this is code/);
  assert.equal(result.turns[1].messages[1].content, '第二个答案');
  assert.equal(result.turns[0].provenance?.parser, 'manual-text');
  assert.equal(
    importManual('You said:\nHi\nChatGPT said:\nHello').turns[0].messages
      .length,
    2,
  );
});
void test('unmarked copy is explicit; ambiguous preamble and incomplete JSON never silently lose content', () => {
  assert.match(importManual('a freeform paragraph').warning || '', /未识别/);
  assert.throws(
    () => importManual('important first paragraph\n用户：question'),
    /首个角色/,
  );
  assert.throws(() => importManual('助手：answer\n用户：question'), /助手回复/);
  assert.throws(() => importManual('{"messages":['), /JSON/);
  assert.equal(
    importManual('{literal text}', '', 'text').turns[0].messages[0].content,
    '{literal text}',
  );
  assert.throws(() => importManual('x'.repeat(2 * 1024 * 1024 + 1)), /超过/);
});
void test('manual JSON and delivery share protocol parsers and filter hidden reasoning', () => {
  const json = {
    input: [
      { role: 'user', content: 'q' },
      { type: 'reasoning', summary: [{ text: 'SECRET' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'a' }] },
    ],
  };
  assert.equal(importManual(JSON.stringify(json)).turns[0].messages.length, 2);
  assert.ok(
    !JSON.stringify(importManual(JSON.stringify(json))).includes('SECRET'),
  );
  assert.equal(importManual('[{"role":"user","content":"q"}]').turns.length, 1);
  assert.throws(
    () =>
      getProtocol('responses').parse({
        input: 'q',
        previous_response_id: 'remote',
      }),
    /远程历史/,
  );
  assert.throws(() => getProtocol('__proto__'), /协议/);
});
const id = '00000000-0000-4000-8000-000000000001';
void test('share addresses are allowlisted and canonicalized, with no arbitrary fetch or redirect', async () => {
  for (const url of [
    'http://chatgpt.com/share/' + id,
    'https://chatgpt.com.evil.test/share/' + id,
    'https://user@chatgpt.com/share/' + id,
    'https://127.0.0.1/share/' + id,
    'https://claude.ai:444/share/' + id,
    'https://chatgpt.com/share/not-an-id',
  ]) {
    assert.throws(() => resolveShareUrl(url));
  }
  assert.equal(
    resolveShareUrl(`https://chatgpt.com/share/${id}?tracking=discard#fragment`)
      .canonical,
    `https://chatgpt.com/share/${id}`,
  );
  let calls = 0;
  await assert.rejects(
    importShare(`https://chatgpt.com/share/${id}`, '', (async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, 'manual');
      return new Response('', {
        status: 302,
        headers: { Location: 'http://127.0.0.1/' },
      });
    }) as typeof fetch),
    /无法读取/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    importShare(
      `https://claude.ai/share/${id}`,
      '',
      (async () => new Response('', { status: 403 })) as typeof fetch,
    ),
    /限制访问/,
  );
});

function shareHtml(conversation: unknown) {
  return `<script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { conversation } } })}</script>`;
}
void test('ChatGPT mapping follows the selected branch, preserving tools and skipping hidden thoughts', () => {
  const conversation = {
    title: 'fixture',
    current_node: 'a',
    mapping: {
      root: { parent: null, message: null },
      u: {
        parent: 'root',
        message: { author: { role: 'user' }, content: { parts: ['question'] } },
      },
      hidden: {
        parent: 'u',
        message: {
          author: { role: 'assistant' },
          channel: 'analysis',
          content: { parts: ['SECRET'] },
        },
      },
      tool: {
        parent: 'hidden',
        message: {
          author: { role: 'tool', name: 'search' },
          content: { parts: ['tool result'] },
        },
      },
      a: {
        parent: 'tool',
        message: {
          author: { role: 'assistant' },
          content: { parts: ['answer\n```js\nconst a = 1;\n```'] },
        },
      },
      other: {
        parent: 'u',
        message: {
          author: { role: 'assistant' },
          content: { parts: ['unused branch'] },
        },
      },
    },
  };
  const parsed = parseChatGPTShare(shareHtml(conversation));
  assert.deepEqual(
    parsed.messages.map((m) => m.role),
    ['user', 'tool_result', 'assistant'],
  );
  assert.ok(!JSON.stringify(parsed).includes('SECRET'));
  assert.ok(!JSON.stringify(parsed).includes('unused branch'));
  assert.match(parsed.messages[2].content, /```js/);
  assert.throws(
    () =>
      parseChatGPTShare(
        shareHtml({ ...conversation, current_node: 'missing' }),
      ),
    /消息链/,
  );
});
void test('router tables are decoded as bounded data and do not execute source', () => {
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        decodeRouterTable('[{"_1":2},"loaderData",{"_3":4},"title","safe"]'),
      ),
    ),
    { loaderData: { title: 'safe' } },
  );
  assert.throws(() => decodeRouterTable('globalThis.bad = true'));
  assert.throws(() => decodeRouterTable('[{"_1":999},"x"]'));
  assert.throws(
    () => parseChatGPTShare('<html>Conversation has been deleted</html>'),
    /删除/,
  );
  assert.throws(
    () => parseChatGPTShare('<html>Sign in</html>'),
    /完整对话数据/,
  );
});
void test('Claude keeps public text and tool order while marking unavailable tool output and assets', () => {
  const parsed = parseClaudeShare({
    name: 'fixture',
    chat_messages: [
      {
        sender: 'human',
        text: 'question',
        attachments: [{ name: 'hidden.pdf' }],
      },
      {
        sender: 'assistant',
        content: [
          { type: 'thinking', thinking: 'SECRET' },
          { type: 'text', text: 'first' },
          { type: 'tool_use', name: 'read', id: 't1' },
          { type: 'tool_result', tool_use_id: 't1' },
          { type: 'text', text: 'last' },
        ],
      },
    ],
  });
  assert.deepEqual(
    parsed.messages.map((m) => m.role),
    ['user', 'assistant', 'tool_call', 'tool_result', 'assistant'],
  );
  assert.ok(!JSON.stringify(parsed).includes('SECRET'));
  assert.match(parsed.messages[0].content, /附件引用/);
  assert.match(parsed.messages[3].content, /未在分享中公开/);
  assert.equal(parsed.messages[4].content, 'last');
});

void test('Claude follows the selected shared branch and rejects a broken parent chain', () => {
  const data = {
    current_leaf_message_uuid: 'chosen',
    chat_messages: [
      {
        uuid: 'u',
        parent_message_uuid: '00000000-0000-0000-0000-000000000000',
        sender: 'human',
        content: [],
        text: 'question',
      },
      {
        uuid: 'other',
        parent_message_uuid: 'u',
        sender: 'assistant',
        text: 'unused branch',
      },
      {
        uuid: 'chosen',
        parent_message_uuid: 'u',
        sender: 'assistant',
        content: [
          { type: 'text', text: 'answer' },
          { type: 'future_attachment' },
        ],
      },
    ],
  };
  const parsed = parseClaudeShare(data);
  assert.equal(parsed.messages[0].content, 'question');
  assert.ok(!JSON.stringify(parsed).includes('unused branch'));
  assert.ok(parsed.issues.some((i) => i.code === 'UNSUPPORTED_CONTENT'));
  assert.throws(
    () => parseClaudeShare({ ...data, current_leaf_message_uuid: 'missing' }),
    /消息链/,
  );
});
