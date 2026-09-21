import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SHARE_ID, browserErrors } from '../../lib/imports/share-transport.ts';
import { runShareBrowser } from './runner.mjs';

export async function createShareBrowserService(root, run = runShareBrowser) {
  const key = randomBytes(32).toString('hex');
  let active = null,
    closing = false;
  const fail = (response, code, status = 503) => {
    response.writeHead(status, {
      'x-context-hub-browser-error': code,
      'Cache-Control': 'no-store',
    });
    response.end();
  };
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization || ''),
      expected = Buffer.from(`Bearer ${key}`);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      request.resume();
      response.writeHead(401).end();
      return;
    }
    if (request.url !== '/' || request.method !== 'POST') {
      request.resume();
      response.writeHead(404).end();
      return;
    }
    if (closing || active) {
      request.resume();
      fail(response, 'BROWSER_BUSY');
      return;
    }
    const controller = new AbortController();
    let done;
    const finished = new Promise((resolve) => {
      done = resolve;
    });
    active = { controller, finished };
    response.once('close', () => {
      if (!response.writableFinished) controller.abort();
    });
    const readTimer = setTimeout(() => request.destroy(), 3000);
    try {
      let id = '';
      for await (const chunk of request) {
        id += chunk.toString('utf8');
        if (Buffer.byteLength(id) > 36) throw new Error('invalid');
      }
      clearTimeout(readTimer);
      if (!SHARE_ID.test(id)) {
        fail(response, 'SOURCE_READ_FAILED', 400);
        return;
      }
      const result = await run(root, id, controller.signal);
      if (response.destroyed) return;
      response.writeHead(result.status, {
        'Content-Type':
          result.type === 'application/json'
            ? 'application/json'
            : 'text/plain',
        'Cache-Control': 'no-store',
        'x-context-hub-browser-response': '1',
        ...(result.challenge ? { 'cf-mitigated': 'challenge' } : {}),
      });
      response.end(result.body);
    } catch (error) {
      if (!response.destroyed)
        fail(
          response,
          Object.hasOwn(browserErrors, error.message)
            ? error.message
            : 'SOURCE_READ_FAILED',
        );
    } finally {
      clearTimeout(readTimer);
      controller.abort();
      active = null;
      done();
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    key,
    async close() {
      closing = true;
      active?.controller.abort();
      const finished = active?.finished;
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await finished;
    },
  };
}
