import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unstable_dev } from 'wrangler';
import { blankWorkspace, groupTurns } from '../lib/domain.ts';
import { runTaskOnce } from '../scripts/background-runner.mjs';

// Isolated database, synthetic inputs/credentials and local upstream only.
const directory = await mkdtemp(join(tmpdir(), 'context-hub-background-http-'));
const runnerKey = 'synthetic-http-runner-key';
const requests = [];
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push({ body: JSON.parse(raw), auth: req.headers.authorization });
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: `后台测试摘要 ${requests.length}` },
        },
      ],
    }),
  );
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
let worker,
  origin,
  cookie = '';
try {
  const envFile = join(directory, '.env.model');
  const runnerFile = join(directory, '.env.runner');
  const persistTo = join(directory, 'state');
  await writeFile(
    envFile,
    `CONTEXT_HUB_SUMMARY_BASE_URL=http://127.0.0.1:${upstream.address().port}/v1\nCONTEXT_HUB_SUMMARY_MODEL=synthetic-test\nCONTEXT_HUB_SUMMARY_API_KEY=synthetic-http-model-key\nCONTEXT_HUB_SUMMARY_PROTOCOL=openai\n`,
  );
  await writeFile(runnerFile, `CONTEXT_HUB_TASK_RUNNER_KEY=${runnerKey}\n`);
  await promisify(execFile)(
    process.execPath,
    [
      '--import',
      './scripts/local-runtime.mjs',
      './node_modules/wrangler/bin/wrangler.js',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--config',
      'dist/server/wrangler.json',
      '--persist-to',
      persistTo,
    ],
    { windowsHide: true },
  );
  const start = async () => {
    worker = await unstable_dev('dist/server/index.js', {
      config: 'dist/server/wrangler.json',
      envFiles: [envFile, runnerFile],
      port: 0,
      inspectorPort: 0,
      ip: '127.0.0.1',
      local: true,
      persist: true,
      persistTo,
      logLevel: 'none',
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
      },
    });
    origin = `http://${worker.address}:${worker.port}`;
    const ready = await fetch(`${origin}/api/tasks/list`, {
      headers: { origin, 'x-context-hub': '1' },
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(ready.status, 200, await ready.text());
  };
  await start();
  const request = async (action, body, extras = {}) => {
    const response = await fetch(`${origin}/api/tasks/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        'x-context-hub': '1',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extras,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    const raw = await response.text();
    assert.ok(
      response.headers.get('content-type')?.includes('application/json'),
      `${action}: HTTP ${response.status}: ${raw.slice(0, 300)}`,
    );
    return { status: response.status, data: JSON.parse(raw) };
  };
  const session = await request('session', {});
  assert.equal(session.status, 200);
  assert.equal(session.data.ready, true);
  const workspace = blankWorkspace('HTTP 后台测试');
  workspace.turns = groupTurns(
    Array.from({ length: 5 }, (_, i) => [
      { role: 'user', content: `Question ${i}` },
      { role: 'assistant', content: `Answer ${i}` },
    ]).flat(),
  );
  workspace.config = {
    ...workspace.config,
    configured: true,
    modelEnabled: true,
    batch: 2,
    review: false,
  };
  workspace.retain = 1;
  const input = {
    id: 'http-background-summary-001',
    kind: 'summary',
    workspace,
  };
  assert.equal((await request('enqueue', input)).status, 200);
  assert.equal((await request('enqueue', input)).status, 200);
  assert.equal(requests.length, 0);
  await worker.stop();
  await start();
  // No browser list/result/ack requests while the runner processes both batches.
  const signal = new AbortController().signal;
  assert.equal(await runTaskOnce(origin, runnerKey, signal), true);
  assert.equal(await runTaskOnce(origin, runnerKey, signal), true);
  assert.equal(await runTaskOnce(origin, runnerKey, signal), false);
  const listing = await request('list');
  const task = listing.data.tasks.find((t) => t.id === input.id);
  assert.equal(task.status, 'completed');
  assert.equal(task.step, 2);
  assert.equal(task.acknowledged, 0);
  assert.equal(requests.length, 2);
  assert.ok(
    requests.every((r) => r.auth === 'Bearer synthetic-http-model-key'),
  );
  assert.ok(!JSON.stringify(listing).includes(runnerKey));
  for (let step = 1; step <= 2; step++) {
    const result = await request(`result?id=${input.id}&step=${step}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.result.kind, 'summary');
    assert.equal((await request('ack', { id: input.id, step })).status, 200);
  }
  assert.equal(
    (await request(`result?id=${input.id}&step=2`)).data.result,
    null,
  );
  const attachment = {
    id: 'file',
    name: 'facts.txt',
    type: 'text/plain',
    url: 'https://files.example/facts.txt',
    status: 'remote',
  };
  const fileId = 'http-background-file-001';
  assert.equal(
    (
      await request('enqueue', {
        id: fileId,
        kind: 'attachments',
        attachments: [attachment],
      })
    ).status,
    200,
  );
  const bytes = Buffer.from('完整附件正文😀'.repeat(20000));
  const dataUrl = `data:text/plain;base64,${bytes.toString('base64')}`;
  await runTaskOnce(origin, runnerKey, signal, async () => dataUrl);
  const saved = (await request(`result?id=${fileId}&step=1`)).data.result
    .attachment;
  assert.equal(saved.url, dataUrl);
  assert.equal(saved.status, 'stored');
  assert.equal(saved.size, bytes.length);
  assert.equal(saved.sha256.length, 64);
  assert.equal((await request('runner-claim', {})).status, 403);
  assert.equal(
    (await request('enqueue', input, { origin: 'https://other.example' }))
      .status,
    403,
  );
  assert.equal((await request('enqueue', '{')).status, 400);
  assert.equal((await request('control', 'x'.repeat(8193))).status, 413);
  assert.equal(
    (await request('list')).status,
    200,
    'rejected request bodies do not poison the local HTTP proxy',
  );
  assert.equal((await request('cancel-all', {})).status, 200);
  assert.ok(
    (await request('list')).data.tasks.every((t) => t.status === 'cancelled'),
  );
  console.log(
    'PASS background HTTP: isolated D1 restart, two model batches without browser requests, durable results, byte-exact attachment, private runtime bindings, rejection recovery and cancellation',
  );
} finally {
  await worker?.stop();
  await new Promise((resolve) => upstream.close(resolve));
  // directory comes directly from mkdtemp under the OS temporary directory.
  await rm(directory, { recursive: true, force: true });
}
