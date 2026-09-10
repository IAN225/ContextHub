import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace, coverage, type Workspace } from '../lib/domain.ts';
import { applyWorkspaceCommand } from '../lib/hub-state.ts';
import { createPersistentSession } from '../lib/persistent-session.ts';
import { composeSummaryInput } from '../lib/summary/prompts.ts';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
  planWorkbench,
} from '../lib/summary/planning.ts';
import { summaryProvider } from '../lib/summary/providers/index.ts';
import { generateSummary } from '../lib/summary/server/service.ts';
import { summaryConnectionStatus } from '../lib/summary/server/config.ts';
import { createSummaryHandler } from '../lib/summary/server/handlers.ts';
import type { SummaryInput } from '../lib/summary/contracts.ts';

const env = {
  CONTEXT_HUB_SUMMARY_BASE_URL: 'https://provider.example/v1',
  CONTEXT_HUB_SUMMARY_MODEL: 'test-model',
  CONTEXT_HUB_SUMMARY_API_KEY: 'synthetic-test-credential',
  CONTEXT_HUB_SUMMARY_PROTOCOL: 'openai',
};
const result = {
  text: 'Complete synthetic model summary',
  model: 'test-model',
  protocol: 'openai' as const,
};
function workspace(): Workspace {
  return {
    ...blankWorkspace('summary test'),
    retain: 2,
    turns: Array.from({ length: 6 }, (_, i) => ({
      id: `turn-${i}`,
      title: `Turn ${i}`,
      time: null,
      source: 'test',
      status: 'normal' as const,
      messages: [
        { role: 'user', content: `Question ${i}` },
        { role: 'assistant', content: `Answer ${i}` },
      ],
    })),
    config: {
      configured: true,
      modelEnabled: true,
      batch: 2,
      auto: false,
      review: false,
      budget: 32000,
      maxOutput: 512,
      system: 'Summarize faithfully.',
    },
  };
}
const input = (): SummaryInput => ({
  system: 'Summarize',
  user: 'Some test context',
  config: { budget: 8000, maxOutput: 512 },
});
const openaiResponse = (text = 'Complete summary', finish = 'stop') =>
  Response.json({
    choices: [
      {
        finish_reason: finish,
        message: {
          content: text,
          reasoning_content: 'hidden reasoning must not be stored',
        },
      },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 5 },
  });
const req = (
  body = input(),
  id = 'test-request-000001',
  origin = 'http://localhost:3000',
) =>
  new Request('http://localhost:3000/api/summary/generate', {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      'X-Context-Hub': '1',
      'Idempotency-Key': id,
    },
    body: JSON.stringify(body),
  });
void test('local Responses thinking setting overrides stale browser settings and preserves unconfigured connections', async () => {
  for (const forced of ['关闭', undefined]) {
    const connection = {
      ...env,
      CONTEXT_HUB_SUMMARY_PROTOCOL: 'responses',
      CONTEXT_HUB_SUMMARY_THINKING: forced,
    };
    const original = {
      ...input(),
      config: { ...input().config, thinking: 'high' },
    };
    assert.equal(summaryConnectionStatus(connection).thinking, forced);
    await generateSummary(
      original,
      connection,
      undefined,
      async (url, init) => {
        assert.equal(url, 'https://provider.example/v1/responses');
        assert.ok(typeof init?.body === 'string');
        const body = JSON.parse(init.body);
        assert.deepEqual(body.reasoning, { effort: forced ? 'none' : 'high' });
        assert.equal(body.max_output_tokens, 512);
        assert.equal(body.thinking, undefined);
        return Response.json({
          status: 'completed',
          output: [
            {
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: 'Test summary' }],
            },
          ],
        });
      },
    );
    assert.equal(original.config.thinking, 'high');
  }
  const invalid = { ...env, CONTEXT_HUB_SUMMARY_THINKING: 'invalid' };
  assert.equal(summaryConnectionStatus(invalid).ready, false);
  await assert.rejects(
    () =>
      generateSummary(input(), invalid, undefined, async () => {
        assert.fail('invalid settings must not call upstream');
      }),
    /不支持的思考设置/,
  );
});
void test('old demo configuration cannot start model calls and explicit activation clears demo auto-run state', () => {
  const w = workspace();
  delete w.config.modelEnabled;
  w.config.auto = true;
  w.started = true;
  w.firstComplete = true;
  assert.throws(() => planCompression(w), /模型配置/);
  const enabled = applyWorkspaceCommand(w, {
    type: 'summary/config',
    patch: { modelEnabled: true },
  });
  assert.equal(enabled.config.auto, false);
  assert.equal(enabled.started, false);
  assert.equal(enabled.firstComplete, false);
  assert.ok(planCompression(enabled));
});
void test('summary input obeys block order and contains complete assistant/tool messages without hidden reasoning or attachment bytes', () => {
  const w = workspace();
  w.config.promptBlocks = [
    { id: 'before', type: 'text', text: 'BEFORE' },
    { id: 'raw', type: 'recent' },
    { id: 'after', type: 'text', text: 'AFTER' },
  ];
  w.turns[0].messages.push(
    { role: 'tool', content: 'tool-result', callId: 'call-1' },
    { role: 'reasoning', content: 'DO-NOT-SEND' },
  );
  w.turns[0].attachments = [
    {
      id: 'a',
      name: 'photo.png',
      type: 'image/png',
      url: 'data:image/png;base64,PRIVATE-BYTES',
    },
  ];
  const plan = planCompression(w)!;
  assert.deepEqual(plan.turnIds, ['turn-0', 'turn-1']);
  assert.ok(plan.input.user.startsWith('BEFORE'));
  assert.ok(plan.input.user.endsWith('AFTER'));
  assert.match(plan.input.user, /tool-result/);
  assert.match(plan.input.user, /call-1/);
  assert.doesNotMatch(plan.input.user, /DO-NOT-SEND|PRIVATE-BYTES/);
  assert.match(plan.input.user, /未提供附件正文/);
});
void test('budget reduces whole-turn batches and rejects an oversized first turn without moving the watermark', () => {
  const w = workspace();
  w.config.budget = 4096;
  w.turns[1].messages[0].content = 'large'.repeat(2000);
  assert.deepEqual(planCompression(w)!.turnIds, ['turn-0']);
  w.turns[0].messages[0].content = 'large'.repeat(2000);
  assert.throws(() => planCompression(w), /不会截断轮次/);
  assert.equal(w.watermark, null);
  w.config.maxOutput = 99999;
  assert.throws(() => planCompression(w), /最大输出/);
});
void test('real checkpoints replace summary text, preserve the retained window, and are idempotent', () => {
  const w = workspace(),
    plan = planCompression(w)!;
  const checkpoint = checkpointFromResult(
    plan,
    result,
    'checkpoint-1',
    '2026-09-09',
  );
  const next = applyGeneratedCheckpoint(w, checkpoint);
  assert.equal(next.watermark, 'turn-1');
  assert.equal(next.summaries[0].text, result.text);
  assert.equal(next.summaries[0].generation?.model, result.model);
  assert.equal(next.firstComplete, false);
  assert.equal(applyGeneratedCheckpoint(next, checkpoint), next);
  const nextPlan = planCompression(next)!;
  assert.match(nextPlan.input.user, /Complete synthetic model summary/);
  const done = applyGeneratedCheckpoint(
    next,
    checkpointFromResult(
      nextPlan,
      { ...result, text: 'New complete summary' },
      'checkpoint-2',
      '2026-09-09',
    ),
  );
  assert.equal(done.summaries[1].text, 'New complete summary');
  assert.deepEqual(done.summaries[1].covered, [
    'turn-0',
    'turn-1',
    'turn-2',
    'turn-3',
  ]);
  assert.equal(done.firstComplete, true);
  assert.deepEqual(
    coverage(done).recent.map((t) => t.id),
    ['turn-4', 'turn-5'],
  );
  assert.equal(planCompression(done), null);
});
void test('stale responses cannot overwrite edits, config changes, or a restored watermark', () => {
  const w = workspace(),
    generated = checkpointFromResult(
      planCompression(w)!,
      result,
      'checkpoint',
      '2026-09-09',
    );
  for (const mutate of [
    (value: Workspace) => {
      value.turns[0].messages[0].content = 'edited';
    },
    (value: Workspace) => {
      value.retain = 3;
    },
    (value: Workspace) => {
      value.watermark = 'turn-2';
    },
    (value: Workspace) => {
      value.config.system = 'Changed prompt';
    },
  ]) {
    const changed = structuredClone(w);
    mutate(changed);
    assert.throws(
      () =>
        applyWorkspaceCommand(changed, {
          type: 'summary/generated',
          generated,
        }),
      /已经变化/,
    );
    assert.equal(changed.summaries.length, 0);
  }
  assert.equal(
    applyGeneratedCheckpoint({ ...w, name: 'renamed' }, generated).name,
    'renamed',
  );
});
void test('failed durable save keeps the original checkpoint and allows saving the same generated result without another call', async () => {
  let fail = true;
  const w = workspace(),
    generated = checkpointFromResult(
      planCompression(w)!,
      result,
      'checkpoint',
      '2026-09-09',
    );
  const session = createPersistentSession('summary', w, {
    read: async () => w,
    write: async () => {
      if (fail) throw new Error('Disk full');
    },
  });
  await session.load();
  const save = () =>
    session.commit((current) => applyGeneratedCheckpoint(current, generated));
  assert.equal(await save(), false);
  assert.equal(session.getSnapshot().value.watermark, null);
  fail = false;
  assert.equal(await save(), true);
  assert.equal(session.getSnapshot().value.watermark, 'turn-1');
});
void test('prompt references and workbench ranges cannot silently omit source turns or previous coverage', () => {
  const w = workspace();
  w.config.promptBlocks = [{ id: 's', type: 'summary' }];
  assert.throws(() => composeSummaryInput(w, w.turns), /原文滑动窗口/);
  w.config.promptBlocks = [{ id: 't', type: 'recent' }];
  const previous = {
    id: 'previous',
    title: 'Previous',
    text: 'Important facts',
    covered: ['turn-0'],
    createdAt: '2026-09-09',
  };
  assert.throws(
    () => composeSummaryInput(w, w.turns, previous),
    /当前活跃摘要/,
  );
  delete w.config.promptBlocks;
  const plan = planWorkbench(w, [w.turns[1]], previous, 'Preserve the plan');
  assert.deepEqual(plan.covered, ['turn-0', 'turn-1']);
  assert.match(plan.input.user, /Preserve the plan/);
  assert.throws(() => planWorkbench(w, [], previous), /至少一个/);
  w.turns[1].messages[0].content = 'x'.repeat(40000);
  assert.throws(() => planWorkbench(w, [w.turns[1]], previous), /不会静默省略/);
});
void test('four protocol adapters send the correct limits and only accept completed visible text', () => {
  for (const [protocol, field, path] of [
    ['openai', 'max_completion_tokens', '/chat/completions'],
    ['responses', 'max_output_tokens', '/responses'],
    ['anthropic', 'max_tokens', '/messages'],
    ['gemini', 'maxOutputTokens', '/models/test-model:generateContent'],
  ] as const) {
    const built = summaryProvider(protocol).build(
      input(),
      'test-model',
      'synthetic',
    );
    assert.equal(built.path, path);
    assert.equal(
      protocol === 'gemini'
        ? (built.body.generationConfig as Record<string, number>)[field]
        : built.body[field],
      512,
    );
  }
  const anthropic = summaryProvider('anthropic').parse({
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: 'secret' },
      { type: 'text', text: 'Visible summary' },
    ],
  });
  assert.equal(anthropic.text, 'Visible summary');
  const gemini = summaryProvider('gemini').parse({
    candidates: [
      {
        finishReason: 'STOP',
        content: {
          parts: [
            { thought: true, text: 'secret' },
            { text: 'Visible summary' },
          ],
        },
      },
    ],
  });
  assert.equal(gemini.text, 'Visible summary');
  const responses = summaryProvider('responses').parse({
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [{ text: 'secret' }] },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Visible summary' }],
      },
    ],
  });
  assert.equal(responses.text, 'Visible summary');
  assert.throws(
    () =>
      summaryProvider('openai').parse({
        choices: [{ finish_reason: 'length', message: { content: 'partial' } }],
      }),
    /未正常完成/,
  );
  assert.throws(
    () =>
      summaryProvider('responses').parse({ status: 'incomplete', output: [] }),
    /未正常完成/,
  );
  assert.throws(
    () =>
      summaryProvider('anthropic').parse({
        stop_reason: 'tool_use',
        content: [],
      }),
    /未正常完成/,
  );
  assert.throws(
    () =>
      summaryProvider('gemini').parse({
        candidates: [{ finishReason: 'MAX_TOKENS' }],
      }),
    /未正常完成/,
  );
  assert.throws(
    () =>
      summaryProvider('openai').build(
        { ...input(), config: { outputField: 'maxOutputTokens' } },
        'model',
        'synthetic',
      ),
    /协议不匹配/,
  );
});
void test('server credentials are absent from public status and cannot be redirected by browser configuration', async () => {
  assert.equal(summaryConnectionStatus({}).ready, false);
  assert.equal(summaryConnectionStatus(env).ready, true);
  assert.ok(
    !JSON.stringify(summaryConnectionStatus(env)).includes(
      env.CONTEXT_HUB_SUMMARY_API_KEY,
    ),
  );
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return openaiResponse();
  };
  await assert.rejects(
    () =>
      generateSummary(
        { ...input(), config: { baseUrl: 'https://other.example/v1' } },
        env,
        undefined,
        fetcher,
      ),
    /本地凭据绑定/,
  );
  await assert.rejects(
    () => generateSummary(input(), {}, undefined, fetcher),
    { code: 'SUMMARY_NOT_READY' },
  );
  assert.equal(calls, 0);
  const summary = await generateSummary(
    input(),
    env,
    undefined,
    async (url, init) => {
      assert.equal(url, 'https://provider.example/v1/chat/completions');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Bearer ${env.CONTEXT_HUB_SUMMARY_API_KEY}`,
      );
      assert.equal(init?.redirect, 'manual');
      return openaiResponse('<think>private reasoning</think>Visible summary');
    },
  );
  assert.equal(summary.text, 'Visible summary');
  assert.ok(!JSON.stringify(summary).includes('reasoning'));
});
void test('provider errors, malformed output, refusal and cancellation never return fallback summaries or raw credentials', async () => {
  for (const status of [400, 401, 429, 500]) {
    await assert.rejects(
      () =>
        generateSummary(
          input(),
          env,
          undefined,
          async () =>
            new Response(`secret ${env.CONTEXT_HUB_SUMMARY_API_KEY}`, {
              status,
            }),
        ),
      (error: Error) =>
        !error.message.includes('secret') &&
        !error.message.includes(env.CONTEXT_HUB_SUMMARY_API_KEY),
    );
  }
  await assert.rejects(
    () =>
      generateSummary(
        input(),
        env,
        undefined,
        async () => new Response('not JSON'),
      ),
    /有效 JSON/,
  );
  await assert.rejects(
    () =>
      generateSummary(input(), env, undefined, async () => openaiResponse('')),
    /正文/,
  );
  const aborter = new AbortController();
  aborter.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      generateSummary(input(), env, aborter.signal, async () => {
        calls++;
        return openaiResponse();
      }),
    /取消/,
  );
  assert.equal(calls, 0);
});
void test('local summary route rejects cross-origin requests and deduplicates retries without another model call', async () => {
  const handler = createSummaryHandler();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return openaiResponse();
  };
  assert.equal(
    (
      await handler(
        req(input(), 'forbidden-request', 'https://untrusted.example'),
        'generate',
        env,
        fetcher,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
  const first = await handler(req(), 'generate', env, fetcher);
  assert.equal(first.status, 200);
  const repeated = await handler(req(), 'generate', env, fetcher);
  assert.deepEqual(await repeated.json(), await first.json());
  assert.equal(calls, 1);
  assert.equal(
    (
      await handler(
        req({ ...input(), user: 'changed' }),
        'generate',
        env,
        fetcher,
      )
    ).status,
    409,
  );
  assert.equal(calls, 1);
});
void test('concurrent distinct tasks are rejected while an identical request waits for the same result', async () => {
  const handler = createSummaryHandler();
  let resolve!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const hold = new Promise<void>((r) => {
    resolve = r;
  });
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    started();
    await hold;
    return openaiResponse();
  };
  const first = handler(req(), 'generate', env, fetcher);
  await ready;
  const repeat = handler(req(), 'generate', env, fetcher);
  assert.equal(
    (await handler(req(input(), 'different-request'), 'generate', env, fetcher))
      .status,
    409,
  );
  resolve();
  assert.equal((await first).status, 200);
  assert.equal((await repeat).status, 200);
  assert.equal(calls, 1);
});
void test('probe reports acceptance separately from unverified thinking capability', async () => {
  const response = await createSummaryHandler()(
    req({ ...input(), config: { ...input().config, thinking: 'low' } }),
    'probe',
    env,
    async () => openaiResponse('OK'),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as { probes: { status: string }[] };
  assert.deepEqual(
    body.probes.map((probe) => probe.status),
    ['字段被接受', '无法确认是否生效'],
  );
});
