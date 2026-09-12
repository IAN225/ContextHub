import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { publicModelRequest } from '../scripts/server/model-proxy.mjs';
void test('cloud model requests reject private DNS, pin public sockets, filter headers and never follow redirects', async () => {
  const input = {
    url: 'https://model.example/v1/chat/completions',
    headers: {
      Authorization: 'Bearer synthetic-key',
      Cookie: 'private-cookie',
      Host: 'evil.example',
    },
    body: '{}',
  };
  await assert.rejects(
    publicModelRequest(input, undefined, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }),
  );
  let calls = 0;
  const result = await publicModelRequest(input, undefined, {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (url, options, callback) => {
      calls++;
      assert.equal(url.hostname, 'model.example');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
      assert.equal(options.headers.Cookie, undefined);
      assert.equal(options.headers.Host, undefined);
      options.lookup('model.example', { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]);
      });
      const req = new EventEmitter();
      req.end = (body) => {
        assert.equal(body, '{}');
        const res = Readable.from([Buffer.from('redirect')]);
        res.statusCode = 302;
        res.headers = { location: 'https://127.0.0.1' };
        callback(res);
      };
      return req;
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 302);
});
