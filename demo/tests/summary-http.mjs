import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_dev } from 'wrangler';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Entirely synthetic upstream and credentials; never load the user's connection file.
const requests = [];
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  requests.push({
    url: req.url,
    auth: req.headers.authorization,
    body: JSON.parse(raw),
  });
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      choices: [
        { finish_reason: 'stop', message: { content: '完整的测试摘要。' } },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    }),
  );
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const temporary = await mkdtemp(join(tmpdir(), 'context-hub-summary-http-'));
let worker;
try {
  const baseUrl = `http://127.0.0.1:${upstream.address().port}/v1`;
  const envFile = join(temporary, '.env.test');
  await writeFile(
    envFile,
    `CONTEXT_HUB_SUMMARY_BASE_URL=${baseUrl}\nCONTEXT_HUB_SUMMARY_MODEL=test-model\nCONTEXT_HUB_SUMMARY_API_KEY=synthetic-local-test-key\nCONTEXT_HUB_SUMMARY_PROTOCOL=openai\n`,
  );
  const persistTo = join(temporary, 'state');
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
  const start = () =>
    unstable_dev('dist/server/index.js', {
      config: 'dist/server/wrangler.json',
      envFiles: [envFile],
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
  worker = await start();
  let origin = `http://${worker.address}:${worker.port}`;
  const request = (action, body, extra = {}) =>
    fetch(`${origin}/api/summary/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-context-hub': '1',
        origin,
        'content-type': 'application/json',
        'idempotency-key': 'http-test-request-0001',
        ...extra,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  const connection = await request('connection');
  assert.equal(connection.status, 200);
  const metadata = await connection.json();
  assert.equal(metadata.ready, true);
  assert.equal(metadata.apiKey, undefined);
  const input = {
    system: '压缩完整轮次',
    user: '用户：你好\n助手：你好',
    config: { budget: 32000, maxOutput: 1000 },
  };
  for (let retry = 0; retry < 2; retry++) {
    const result = await request('generate', input);
    const payload = await result.json();
    assert.equal(
      result.status,
      200,
      JSON.stringify({ retry, payload, upstreamRequests: requests.length }),
    );
    assert.equal(payload.text, '完整的测试摘要。');
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].auth, 'Bearer synthetic-local-test-key');
  assert.equal(requests[0].body.max_completion_tokens, 1000);
  const forbidden = await request('generate', input, {
    origin: 'https://invalid.example',
  });
  assert.equal(forbidden.status, 403);
  await forbidden.text();
  const malformed = await request('generate', '{');
  assert.equal(malformed.status, 400);
  await malformed.text();
  const oversized = await request('generate', 'x'.repeat(2 * 1024 * 1024 + 1));
  assert.equal(oversized.status, 413);
  await oversized.text();
  const conflict = await request('generate', { ...input, user: 'different' });
  assert.equal(conflict.status, 409);
  await conflict.text();
  const mismatch = await request(
    'generate',
    {
      ...input,
      config: { ...input.config, baseUrl: 'https://invalid.example' },
    },
    { 'idempotency-key': 'http-test-request-0002' },
  );
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, 'CONNECTION_MISMATCH');
  assert.equal(requests.length, 1);
  assert.equal((await request('connection')).status, 200);
  const saved = await request('connection', {
    baseUrl,
    model: 'page-model',
    protocol: 'openai',
    apiKey: '',
    revision: metadata.revision,
  });
  assert.equal(saved.status, 200);
  const savedMetadata = await saved.json();
  assert.equal(savedMetadata.keyConfigured, true);
  assert.ok(
    !JSON.stringify(savedMetadata).includes('synthetic-local-test-key'),
  );
  const changedDestination = await request('connection', {
    baseUrl: 'https://other.example',
    model: 'page-model',
    protocol: 'openai',
    apiKey: '',
    revision: savedMetadata.revision,
  });
  assert.equal(changedDestination.status, 400);
  await changedDestination.text();
  const replacement = await request('connection', {
    baseUrl,
    model: 'page-model',
    protocol: 'openai',
    apiKey: 'synthetic-page-test-key',
    revision: savedMetadata.revision,
  });
  assert.equal(replacement.status, 200);
  await replacement.text();
  const immediate = await request('generate', input, {
    'idempotency-key': 'http-page-config-immediate',
  });
  assert.equal(immediate.status, 200);
  await immediate.text();
  assert.equal(requests.at(-1).auth, 'Bearer synthetic-page-test-key');
  assert.equal(requests.at(-1).body.model, 'page-model');
  await worker.stop();
  worker = await start();
  origin = `http://${worker.address}:${worker.port}`;
  const afterRestart = await request('connection');
  assert.equal(afterRestart.status, 200);
  const persisted = await afterRestart.json();
  assert.equal(persisted.source, 'local');
  assert.equal(persisted.model, 'page-model');
  assert.ok(!JSON.stringify(persisted).includes('synthetic-page-test-key'));
  const generated = await request('generate', input, {
    'idempotency-key': 'http-page-config-restarted',
  });
  assert.equal(generated.status, 200);
  await generated.text();
  assert.equal(requests.at(-1).auth, 'Bearer synthetic-page-test-key');
  assert.equal(requests.length, 3);
  console.log(
    'PASS summary HTTP: private runtime binding, request serialization, retry deduplication, endpoint binding, page configuration without restart, persistent key replacement and no key in public responses',
  );
} finally {
  await worker?.stop();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
