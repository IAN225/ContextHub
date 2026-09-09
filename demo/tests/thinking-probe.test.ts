import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryHandler } from '../lib/summary/server/handlers.ts';

const message = {
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: 'OK' }],
};
async function probe(tokens: unknown, extra: unknown[] = [], setting = '关闭') {
  const request = new Request('http://localhost:3000/api/summary/probe', {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      'x-context-hub': '1',
      'content-type': 'application/json',
      'idempotency-key': 'thinking-probe-test-1',
    },
    body: JSON.stringify({
      system: 'Reply OK.',
      user: 'Test',
      config: { budget: 8000, maxOutput: 256, thinking: 'high' },
    }),
  });
  const response = await createSummaryHandler()(
    request,
    'probe',
    {
      CONTEXT_HUB_SUMMARY_BASE_URL: 'https://provider.example',
      CONTEXT_HUB_SUMMARY_API_KEY: 'synthetic-test-key',
      CONTEXT_HUB_SUMMARY_MODEL: 'test-model',
      CONTEXT_HUB_SUMMARY_PROTOCOL: 'responses',
      CONTEXT_HUB_SUMMARY_THINKING: setting,
    },
    async () =>
      Response.json({
        status: 'completed',
        output: [...extra, message],
        usage: { output_tokens_details: { reasoning_tokens: tokens } },
      }),
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as {
    probes: { field: string; status: string; detail: string }[];
  };
  assert.ok(!JSON.stringify(result).includes('private-thought'));
  return result.probes.find((row) => row.field === '思考设置')!;
}
void test('Responses probe distinguishes reported zero, positive and unavailable thinking token counts', async () => {
  const zero = await probe(0);
  assert.equal(zero.status, '本次未产生思考');
  assert.match(zero.detail, /0/);
  assert.equal((await probe(12)).status, '与设置不符');
  assert.equal((await probe(12, [], 'high')).status, '已观察到思考');
  for (const missing of [undefined, null, -1, '0', 0.5])
    assert.equal((await probe(missing)).status, '无法确认是否生效');
});
void test('nonempty reasoning output outweighs zero counters but empty placeholders are inconclusive', async () => {
  const reasoning = {
    type: 'reasoning',
    content: [{ type: 'reasoning_text', text: 'private-thought' }],
  };
  assert.equal((await probe(undefined, [reasoning])).status, '与设置不符');
  assert.equal((await probe(0, [reasoning])).status, '与设置不符');
  assert.equal(
    (await probe(undefined, [{ type: 'reasoning', content: [], summary: [] }]))
      .status,
    '无法确认是否生效',
  );
  assert.equal(
    (await probe(0, [{ type: 'reasoning', content: [] }])).status,
    '本次未产生思考',
  );
});
