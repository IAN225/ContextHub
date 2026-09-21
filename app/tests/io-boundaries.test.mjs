import { runShareBrowser } from '../scripts/share-browser/runner.mjs';
import { SHARE_MAX_BYTES } from '../lib/imports/share-transport.ts';
import { createShareBrowserService } from '../scripts/share-browser/service.mjs';
import { readClaudeSnapshot } from '../lib/imports/server/claude-browser.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTextBody } from '../lib/server/body.ts';
import { importShare } from '../lib/imports/server/share-service.ts';
import {
  publicAddress,
  resolveAttachmentUrl,
  downloadAttachment,
} from '../scripts/background-runner.mjs';
import { accountContext } from '../lib/account/server.ts';
import { Readable, PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

test('rejected and aborted bodies release their source without consuming it', async () => {
  for (const abort of [false, true]) {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-length': '100' } },
    );
    const controller = new AbortController();
    if (abort) controller.abort();
    await assert.rejects(
      readTextBody(response, 10, {
        signal: controller.signal,
        aborted: () => Error('aborted'),
        tooLarge: () => Error('large'),
      }),
      abort ? /aborted/ : /large/,
    );
    assert.equal(cancelled, true);
  }
});

test('share import rejects redirects and source errors and cancels their bodies', async () => {
  for (const status of [302, 401, 404, 429, 500]) {
    let cancelled = false;
    let requests = 0;
    await assert.rejects(
      importShare(
        'https://chatgpt.com/share/00000000-0000-0000-0000-000000000001',
        '',
        async (_url, options) => {
          requests++;
          assert.equal(options.redirect, 'manual');
          assert.equal(options.headers.Authorization, undefined);
          return new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { status, headers: { location: 'http://127.0.0.1/private' } },
          );
        },
      ),
    );
    assert.equal(cancelled, true);
    assert.equal(requests, 1);
  }
});

test('share import keeps anonymous device sessions request-local and excludes account cookies', async () => {
  const shareId = '00000000-0000-0000-0000-000000000001';
  const deviceIds = [shareId, '00000000-0000-0000-0000-000000000002'];
  const html = `<script type="application/json">${JSON.stringify({
    linear_conversation: [
      {
        message: {
          author: { role: 'user' },
          content: {
            parts: [
              'question',
              {
                content_type: 'image_asset_pointer',
                asset_pointer: 'sediment://file_test',
              },
            ],
          },
        },
      },
    ],
  })}</script>`;
  for (const valid of [true, false]) {
    await Promise.all(
      deviceIds.map(async (id) => {
        let requests = 0;
        const result = await importShare(
          `https://chatgpt.com/share/${shareId}`,
          '',
          async (url, options) => {
            requests++;
            if (requests === 1) {
              assert.equal(options.headers.Cookie, undefined);
              const headers = new Headers();
              headers.append(
                'set-cookie',
                '__Secure-next-auth.session-token=account-secret; Secure',
              );
              headers.append(
                'set-cookie',
                'cf_clearance=challenge-secret; Secure',
              );
              headers.append(
                'set-cookie',
                `oai-did=${valid ? id : 'bad,other=secret'}; Secure; Path=/`,
              );
              return new Response(html, { headers });
            }
            assert.equal(new URL(url).hostname, 'chatgpt.com');
            assert.equal(
              new URL(url).pathname,
              '/backend-anon/files/download/file_test',
            );
            assert.equal(
              options.headers.Cookie,
              valid ? `oai-did=${id}` : undefined,
            );
            assert.equal(options.redirect, 'manual');
            return Response.json({
              download_url: 'https://files.oaiusercontent.com/image.png',
            });
          },
        );
        assert.equal(requests, 2);
        assert.equal(result.turns[0].attachments[0].status, 'remote');
        assert.ok(!JSON.stringify(result).includes('oai-did'));
        assert.ok(!JSON.stringify(result).includes('secret'));
      }),
    );
  }
});

test('share import distinguishes security challenges, rate limits and access refusal', async () => {
  for (const [status, headers, code] of [
    [403, { 'cf-mitigated': 'challenge' }, 'SOURCE_CHALLENGE'],
    [200, { 'cf-mitigated': 'challenge' }, 'SOURCE_CHALLENGE'],
    [429, {}, 'SOURCE_RATE_LIMITED'],
    [403, {}, 'SOURCE_RESTRICTED'],
  ]) {
    let cancelled = false;
    await assert.rejects(
      importShare(
        'https://chatgpt.com/share/00000000-0000-0000-0000-000000000001',
        '',
        async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { status, headers },
          ),
      ),
      (error) => error.code === code,
    );
    assert.equal(cancelled, true);
  }
});

test('attachment DNS rejects non-public, mixed and credential-bearing destinations', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002:7f00:1::',
  ])
    assert.equal(publicAddress(address), false, address);
  for (const url of [
    'http://example.org/a',
    'https://a:b@example.org/a',
    'https://example.org:8443/a',
  ])
    await assert.rejects(resolveAttachmentUrl(url));
  await assert.rejects(
    resolveAttachmentUrl('https://example.org/a', async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]),
    /内网/,
  );
  assert.equal(
    (
      await resolveAttachmentUrl('https://example.org/a', async () => [
        { address: '8.8.8.8', family: 4 },
      ])
    ).address.address,
    '8.8.8.8',
  );
});

test('attachment download pins checked DNS and revalidates redirect destinations', async () => {
  let requests = 0;
  await assert.rejects(
    downloadAttachment(
      { url: 'https://example.org/a' },
      new AbortController().signal,
      {
        lookup: async () => [{ address: '8.8.8.8', family: 4 }],
        request: (_url, options, callback) => {
          requests++;
          options.lookup('example.org', {}, (error, address) => {
            assert.equal(error, null);
            assert.equal(address, '8.8.8.8');
          });
          assert.equal(options.headers.Authorization, undefined);
          const req = new EventEmitter();
          req.end = () => {
            const response = Readable.from([]);
            response.statusCode = 302;
            response.headers = { location: 'http://127.0.0.1/secret' };
            callback(response);
          };
          return req;
        },
      },
    ),
    /HTTPS/,
  );
  assert.equal(requests, 1);
});

test('account identity headers require the private gateway key', () => {
  const id = '00000000-0000-0000-0000-000000000001';
  for (const key of ['', 'forged'])
    assert.equal(
      accountContext(
        new Request('http://internal/api', {
          headers: {
            'x-context-hub-account': id,
            'x-context-hub-account-key': key,
          },
        }),
        {
          CONTEXT_HUB_ACCOUNT_MODE: '1',
          CONTEXT_HUB_MCP_GATEWAY_KEY: 'private',
        },
      ).status,
      401,
    );
  assert.equal(
    accountContext(
      new Request('http://internal/api', {
        headers: {
          'x-context-hub-account': id,
          'x-context-hub-account-key': 'private',
        },
      }),
      { CONTEXT_HUB_ACCOUNT_MODE: '1', CONTEXT_HUB_MCP_GATEWAY_KEY: 'private' },
    ),
    id,
  );
});

test('Claude browser service authenticates, serializes requests and releases a cancelled job', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  let started, complete;
  const running = new Promise((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const service = await createShareBrowserService(
    '/unused',
    async (_root, value, signal) => {
      calls++;
      assert.equal(value, id);
      started();
      await new Promise((resolve, reject) => {
        complete = resolve;
        signal.addEventListener(
          'abort',
          () => reject(new Error('SOURCE_TIMEOUT')),
          { once: true },
        );
      });
      return {
        status: 200,
        type: 'application/json',
        body: Buffer.from('{"chat_messages":[]}'),
      };
    },
  );
  const headers = { Authorization: `Bearer ${service.key}` };
  try {
    assert.equal(
      (await fetch(service.url, { method: 'POST', body: id })).status,
      401,
    );
    const invalid = await fetch(service.url, {
      method: 'POST',
      headers,
      body: 'https://127.0.0.1/private',
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);
    const first = fetch(service.url, { method: 'POST', headers, body: id });
    await running;
    const busy = await fetch(service.url, {
      method: 'POST',
      headers,
      body: id,
    });
    assert.equal(
      busy.headers.get('x-context-hub-browser-error'),
      'BROWSER_BUSY',
    );
    assert.equal(calls, 1);
    complete();
    assert.deepEqual(await (await first).json(), { chat_messages: [] });
    const pending = fetch(service.url, {
      method: 'POST',
      headers,
      body: id,
    }).catch(() => null);
    while (calls < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    await service.close();
    await pending;
  } finally {
    await service.close();
  }
});

test('Claude share transport uses the browser reader without a direct source fetch', async () => {
  let browserId;
  const result = await importShare(
    'https://claude.ai/share/00000000-0000-0000-0000-000000000001',
    '',
    async () => {
      throw Error('Unexpected direct fetch');
    },
    async (id) => {
      browserId = id;
      return Response.json({
        chat_messages: [
          { sender: 'human', text: 'hello' },
          { sender: 'assistant', text: 'answer' },
        ],
      });
    },
  );
  assert.equal(browserId, '00000000-0000-0000-0000-000000000001');
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].messages[1].content, 'answer');
});

test('browser adapter rejects unconfigured service and exposes bounded worker errors', async () => {
  const oldUrl = process.env.CONTEXT_HUB_SHARE_BROWSER_URL,
    oldKey = process.env.CONTEXT_HUB_SHARE_BROWSER_KEY;
  try {
    delete process.env.CONTEXT_HUB_SHARE_BROWSER_URL;
    await assert.rejects(
      readClaudeSnapshot('00000000-0000-0000-0000-000000000001'),
      (e) => e.code === 'BROWSER_UNAVAILABLE',
    );
    process.env.CONTEXT_HUB_SHARE_BROWSER_URL = 'http://127.0.0.1:12345/';
    process.env.CONTEXT_HUB_SHARE_BROWSER_KEY = 'local-test-key';
    await assert.rejects(
      readClaudeSnapshot(
        '00000000-0000-0000-0000-000000000001',
        async (url, options) => {
          assert.equal(url, 'http://127.0.0.1:12345/');
          assert.equal(options.redirect, 'manual');
          assert.equal(options.headers.Authorization, 'Bearer local-test-key');
          return new Response(null, {
            status: 503,
            headers: { 'x-context-hub-browser-error': 'BROWSER_BUSY' },
          });
        },
      ),
      (e) => e.code === 'BROWSER_BUSY',
    );
  } finally {
    if (oldUrl === undefined) delete process.env.CONTEXT_HUB_SHARE_BROWSER_URL;
    else process.env.CONTEXT_HUB_SHARE_BROWSER_URL = oldUrl;
    if (oldKey === undefined) delete process.env.CONTEXT_HUB_SHARE_BROWSER_KEY;
    else process.env.CONTEXT_HUB_SHARE_BROWSER_KEY = oldKey;
  }
});

test('browser child boundary limits output, strips secrets and reports cancellation', async () => {
  for (const scenario of ['success', 'oversized', 'cancelled', 'malformed']) {
    const controller = new AbortController();
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    const previous = process.env.CONTEXT_HUB_MCP_GATEWAY_KEY;
    process.env.CONTEXT_HUB_MCP_GATEWAY_KEY = 'never-forward';
    try {
      const result = runShareBrowser(
        '/runtime',
        '00000000-0000-0000-0000-000000000001',
        controller.signal,
        (_command, _args, options) => {
          assert.equal(options.env.CONTEXT_HUB_MCP_GATEWAY_KEY, undefined);
          assert.equal(options.env.HTTP_PROXY, undefined);
          assert.equal(options.windowsHide, true);
          setImmediate(() => {
            if (scenario === 'success')
              child.stdout.write(
                '{"status":200,"type":"application/json"}\n{"ok":true}',
              );
            if (scenario === 'oversized')
              child.stdout.write(Buffer.alloc(SHARE_MAX_BYTES + 1025));
            if (scenario === 'cancelled') controller.abort();
            if (scenario === 'malformed')
              child.stdout.write('not a worker response');
            child.emit('close', 0);
          });
          return child;
        },
      );
      if (scenario === 'success') {
        const response = await result;
        assert.equal(response.status, 200);
        assert.equal(response.body.toString(), '{"ok":true}');
      } else
        await assert.rejects(
          result,
          new RegExp(
            scenario === 'oversized'
              ? 'TOO_LARGE'
              : scenario === 'cancelled'
                ? 'SOURCE_TIMEOUT'
                : 'BROWSER_UNAVAILABLE',
          ),
        );
    } finally {
      if (previous === undefined)
        delete process.env.CONTEXT_HUB_MCP_GATEWAY_KEY;
      else process.env.CONTEXT_HUB_MCP_GATEWAY_KEY = previous;
    }
  }
});
