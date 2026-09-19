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
import { Readable } from 'node:stream';
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
        'https://claude.ai/share/00000000-0000-0000-0000-000000000001',
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
