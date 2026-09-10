import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDelivery } from '../lib/import.ts';
void test('OpenAI 工具调用与工具结果保留在发起 user 的同一轮', () => {
  const r = parseDelivery(
    {
      messages: [
        { role: 'user', content: '查找' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', function: { name: 'find', arguments: '{"q":"a"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: '找到' },
        { role: 'assistant', content: '完成' },
        { role: 'user', content: '谢谢' },
      ],
    },
    'chat',
  );
  assert.equal(r.length, 2);
  assert.deepEqual(
    r[0].messages.map((m) => m.role),
    ['user', 'tool_call', 'tool_result', 'assistant'],
  );
  assert.equal(r[0].messages[1].callId, 'c1');
});
void test('Anthropic user 容器内的 tool_result 不会生成伪用户轮次', () => {
  const r = parseDelivery(
    {
      messages: [
        { role: 'user', content: '查找' },
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hidden' },
            { type: 'tool_use', id: 'c1', name: 'find', input: { q: 'a' } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'c1', content: '结果' },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: '完成' }] },
      ],
    },
    'messages',
  );
  assert.equal(r.length, 1);
  assert.deepEqual(
    r[0].messages.map((m) => m.role),
    ['user', 'tool_call', 'tool_result', 'assistant'],
  );
  assert.ok(!JSON.stringify(r).includes('hidden'));
});
void test('Responses 输入中的函数调用、结果和图片缺失信息会被保留', () => {
  const r = parseDelivery(
    {
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: '看这张图' },
            { type: 'input_image', image_url: 'https://example.com/a.png' },
          ],
        },
        { type: 'function_call', call_id: 'f1', name: 'look', arguments: '{}' },
        { type: 'reasoning', summary: [{ text: 'hidden' }] },
        { type: 'function_call_output', call_id: 'f1', output: '完成' },
      ],
    },
    'responses',
  );
  assert.equal(r.length, 1);
  assert.ok(r[0].messages[0].content.includes('附件引用'));
  assert.equal(r[0].attachments?.[0].status, 'remote');
  assert.equal(r[0].messages[2].role, 'tool_result');
  assert.ok(!JSON.stringify(r).includes('hidden'));
});
void test('无 user 的不完整请求报错而非显示空导入成功', () => {
  assert.throws(
    () =>
      parseDelivery(
        { messages: [{ role: 'assistant', content: '孤立回复' }] },
        'chat',
      ),
    /用户轮次/,
  );
});
void test('Anthropic assistant 文本与工具调用保持块的原始顺序', () => {
  const r = parseDelivery(
    {
      messages: [
        { role: 'user', content: '查找' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '先查一下' },
            { type: 'tool_use', id: 'c1', name: 'find', input: {} },
            { type: 'text', text: '正在等待' },
          ],
        },
      ],
    },
    'messages',
  );
  assert.deepEqual(
    r[0].messages.map((m) => m.role),
    ['user', 'assistant', 'tool_call', 'assistant'],
  );
  assert.equal(r[0].messages[3].content, '正在等待');
});
