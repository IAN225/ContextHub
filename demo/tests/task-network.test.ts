import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  publicAddress,
  resolveAttachmentUrl,
  downloadAttachment,
} from '../scripts/background-runner.mjs';

void test('attachment DNS validation rejects private, mixed, mapped and non-HTTPS destinations', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('93.184.216.34'), true);
  for (const url of [
    'http://files.example/a',
    'https://user:pass@files.example/a',
    'https://files.example:8443/a',
    'https://127.0.0.1/a',
  ])
    await assert.rejects(resolveAttachmentUrl(url));
  await assert.rejects(
    resolveAttachmentUrl(
      'https://files.example/a',
      async () =>
        [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ] as never,
    ),
    /内网/,
  );
});
void test('downloader pins the verified IP and never forwards credentials, following only revalidated redirects', async () => {
  const lookups: string[] = [],
    seen: Record<string, unknown>[] = [];
  const resolver = async (host: string) => {
    lookups.push(host);
    return [
      {
        address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34',
        family: 4,
      },
    ];
  };
  let count = 0;
  const factory = (
    _url: URL,
    options: Record<string, unknown>,
    done: (r: Readable) => void,
  ) => {
    seen.push(options);
    count++;
    const stream = Object.assign(Readable.from([Buffer.from('file bytes')]), {
      statusCode: count === 1 ? 302 : 200,
      headers:
        count === 1
          ? { location: 'https://cdn.example/a.txt' }
          : { 'content-type': 'text/plain' },
      complete: true,
    });
    const req = new EventEmitter();
    Object.assign(req, { end: () => done(stream) });
    return req;
  };
  const url = await downloadAttachment(
    { url: 'https://files.example/a.txt', name: 'a.txt', type: 'text/plain' },
    new AbortController().signal,
    { lookup: resolver, request: factory },
  );
  assert.equal(
    url,
    `data:text/plain;base64,${Buffer.from('file bytes').toString('base64')}`,
  );
  assert.deepEqual(lookups, ['files.example', 'cdn.example']);
  for (const options of seen) {
    const headers = options.headers as Record<string, unknown>;
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers.Cookie, undefined);
    const resolve = options.lookup as (
      host: string,
      options: { all: boolean },
      cb: (error: unknown, addresses: unknown) => void,
    ) => void;
    resolve('files.example', { all: true }, (error, addresses) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
    });
  }
  const redirectPrivate = (
    _url: URL,
    _options: unknown,
    done: (r: Readable) => void,
  ) => {
    const req = new EventEmitter();
    Object.assign(req, {
      end: () =>
        done(
          Object.assign(Readable.from([]), {
            statusCode: 302,
            headers: { location: 'https://private.example/a' },
            complete: true,
          }),
        ),
    });
    return req;
  };
  await assert.rejects(
    downloadAttachment(
      { url: 'https://files.example/a' },
      new AbortController().signal,
      { lookup: resolver, request: redirectPrivate },
    ),
    /内网/,
  );
});
