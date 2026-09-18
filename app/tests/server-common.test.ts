import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, randomSecret } from '../lib/server/crypto.ts';
import { discardRequestBody, readTextBody } from '../lib/server/body.ts';
import {
  managementOwner,
  requireManagementRequest as importGuard,
} from '../lib/imports/server/auth.ts';
import { readLimitedBody as importBody } from '../lib/imports/server/http.ts';
import type { ImportRepository } from '../lib/imports/server/repository.ts';
import {
  owner as mcpOwner,
  requireManagementRequest as mcpGuard,
  readLimitedBody as mcpBody,
  json,
} from '../lib/mcp/server/http.ts';
import type { McpRepository } from '../lib/mcp/server/repository.ts';
import {
  owner as taskOwner,
  requireManagementRequest as taskGuard,
  body as taskBody,
} from '../lib/tasks/server/http.ts';
import type { TaskRepository } from '../lib/tasks/server/repository.ts';
import { createSummaryHandler } from '../lib/summary/server/handlers.ts';
import { readSummaryBody } from '../lib/summary/server/service.ts';

test('shared crypto keeps SHA-256 and 256-bit prefixed secrets', async () => {
  assert.equal(
    await digest('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const first = randomSecret('ch_delivery_'),
    second = randomSecret('ch_delivery_');
  assert.match(first, /^ch_delivery_[a-f0-9]{64}$/);
  assert.notEqual(first, second);
});

test('session owners use only their own cookie and pass hashes to repositories', async () => {
  const secrets = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
  const seen: string[] = [];
  const session = async (hash: string) => {
    seen.push(hash);
    return 'owner';
  };
  const mcp = { session } as McpRepository;
  const tasks = { session } as TaskRepository;
  const imports = {
    findOwner: async (hash: string) => {
      seen.push(hash);
      return { id: 'owner', key_hash: null };
    },
  } as ImportRepository;
  const request = new Request('https://hub.test', {
    headers: {
      cookie: `ignored=1; context_hub_mcp=${secrets[0]}; context_hub_tasks=${secrets[1]}; context_hub_import_session=${secrets[2]}`,
    },
  });
  assert.equal(await mcpOwner(request, mcp), 'owner');
  assert.equal(await taskOwner(request, tasks), 'owner');
  assert.equal((await managementOwner(request, imports))?.id, 'owner');
  assert.deepEqual(seen, await Promise.all(secrets.map(digest)));
  for (const cookie of [
    '',
    'context_hub_mcp=bad',
    `context_hub_mcp=${'A'.repeat(64)}`,
    `prefix_context_hub_mcp=${secrets[0]}`,
  ]) {
    const invalid = new Request('https://hub.test', { headers: { cookie } });
    assert.equal(await mcpOwner(invalid, mcp), undefined);
    assert.equal(await taskOwner(invalid, tasks), undefined);
    assert.equal(await managementOwner(invalid, imports), null);
  }
  assert.equal(seen.length, 3);
});

test('management policy preserves GET handling and rejects cross-site/missing-origin mutations', async () => {
  for (const guard of [importGuard, mcpGuard, taskGuard]) {
    guard(
      new Request('https://hub.test', { headers: { 'x-context-hub': '1' } }),
    );
    for (const site of ['same-origin', 'none'])
      guard(
        new Request('https://hub.test', {
          method: 'POST',
          headers: {
            'x-context-hub': '1',
            origin: 'https://hub.test',
            'sec-fetch-site': site,
          },
        }),
      );
    for (const headers of [
      {},
      { 'x-context-hub': '1' },
      { 'x-context-hub': '1', origin: 'https://other.test' },
      {
        'x-context-hub': '1',
        origin: 'https://hub.test',
        'sec-fetch-site': 'same-site',
      },
      {
        'x-context-hub': '1',
        origin: 'https://hub.test',
        'sec-fetch-site': 'cross-site',
      },
    ]) {
      assert.throws(
        () =>
          guard(
            new Request('https://hub.test', {
              method: 'POST',
              headers: headers as HeadersInit,
            }),
          ),
        { code: 'FORBIDDEN', status: 403 },
      );
    }
  }
  const response = await createSummaryHandler()(
    new Request('https://hub.test', {
      method: 'POST',
      headers: { 'x-context-hub': '1' },
    }),
    'generate',
    {},
  );
  assert.equal(response.status, 403);
  assert.match(await response.text(), /FORBIDDEN/);
});

test('body limits count streamed UTF-8 bytes and preserve business error codes', async () => {
  for (const [read, code] of [
    [importBody, 'TOO_LARGE'],
    [mcpBody, 'TOO_LARGE'],
    [readSummaryBody, 'SUMMARY_TOO_LARGE'],
  ] as const) {
    assert.equal(await read(new Response('你好'), 6), '你好');
    await assert.rejects(read(new Response('你好'), 5), { code, status: 413 });
    await assert.rejects(
      read(new Response(null, { headers: { 'content-length': '7' } }), 6),
      { code, status: 413 },
    );
    assert.equal(await read(new Response(null), 6), '');
  }
  for (const read of [json, taskBody]) {
    await assert.rejects(
      read(new Request('https://hub.test', { method: 'POST', body: '{}' }), 10),
      { code: 'JSON_REQUIRED', status: 415 },
    );
    await assert.rejects(
      read(
        new Request('https://hub.test', {
          method: 'POST',
          body: '{',
          headers: { 'content-type': 'application/json' },
        }),
        10,
      ),
      { code: 'INVALID_JSON' },
    );
    await assert.rejects(
      read(
        new Request('https://hub.test', {
          method: 'POST',
          body: '{"text":"你好"}',
          headers: { 'content-type': 'application/json' },
        }),
        5,
      ),
      { code: 'TOO_LARGE', status: 413 },
    );
  }
});

test('stream readers release locks and cancel on size failure and pending abort', async () => {
  let cancelled = 0;
  const oversized = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
      },
      cancel() {
        cancelled++;
      },
    }),
  );
  await assert.rejects(
    readTextBody(oversized, 3, { tooLarge: () => new Error('limit') }),
    /limit/,
  );
  assert.equal(cancelled, 1);
  assert.equal(oversized.body!.locked, false);
  const controller = new AbortController();
  const stalled = new Response(
    new ReadableStream({
      cancel() {
        cancelled++;
      },
    }),
  );
  const reading = readSummaryBody(stalled, 20, controller.signal);
  controller.abort();
  await assert.rejects(reading, { code: 'SUMMARY_ABORTED', status: 408 });
  assert.equal(cancelled, 2);
  assert.equal(stalled.body!.locked, false);
  await assert.rejects(
    readSummaryBody(new Response(''), 20, controller.signal),
    { code: 'SUMMARY_ABORTED' },
  );
});

test('discard drains normal bodies and cancels over-budget input', async () => {
  assert.equal(await discardRequestBody(new Request('https://hub.test')), true);
  assert.equal(
    await discardRequestBody(
      new Request('https://hub.test', { method: 'POST', body: 'ignored' }),
    ),
    true,
  );
  const large = new Request('https://hub.test', {
    method: 'POST',
    body: new Uint8Array(8 * 1024 * 1024 + 1),
  });
  assert.equal(await discardRequestBody(large), false);
  assert.equal(large.body!.locked, false);
});
