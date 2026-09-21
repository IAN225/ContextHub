import { chromium } from 'playwright';
import {
  claudeSnapshotUrl,
  SHARE_MAX_BYTES,
  SHARE_BROWSER_TIMEOUT_MS,
} from '../../lib/imports/share-transport.ts';

let browser,
  timer,
  timedOut = false;
const stop = async () => {
  await browser?.close().catch(() => {});
};
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    timedOut = true;
    void stop();
  });
const output = (meta, body = '') =>
  process.stdout.write(JSON.stringify(meta) + '\n' + body);
let errorCode = 'BROWSER_UNAVAILABLE';
try {
  const check = process.argv[2] === '--check';
  let id = '';
  if (!check) {
    for await (const chunk of process.stdin) {
      id += chunk.toString('utf8');
      if (id.length > 36) throw new Error();
    }
  }
  const url = check ? 'about:blank' : claudeSnapshotUrl(id);
  timer = setTimeout(() => {
    timedOut = true;
    void stop();
  }, SHARE_BROWSER_TIMEOUT_MS - 5000);
  browser = await chromium.launch({
    headless: false,
    chromiumSandbox: true,
    timeout: 15000,
  });
  errorCode = 'SOURCE_READ_FAILED';
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
  });
  await context.route('**/*', (route) =>
    route.request().url() === url && route.request().method() === 'GET'
      ? route.continue()
      : route.abort(),
  );
  await context.routeWebSocket('**/*', (route) => route.close());
  const page = await context.newPage();
  // Bound decoded response bytes while Chromium is receiving them, not only after buffering.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let received = 0,
    tooLarge = false;
  const oversized = () => {
    tooLarge = true;
    errorCode = 'TOO_LARGE';
    void page.close().catch(() => {});
  };
  cdp.on('Network.dataReceived', (event) => {
    received += event.dataLength;
    if (received > SHARE_MAX_BYTES) oversized();
  });
  cdp.on('Network.responseReceived', (event) => {
    const length = Object.entries(event.response.headers).find(
      ([name]) => name.toLowerCase() === 'content-length',
    )?.[1];
    if (Number(length) > SHARE_MAX_BYTES) oversized();
  });
  let response;
  try {
    response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
  } catch (error) {
    if (tooLarge) errorCode = 'TOO_LARGE';
    else if (error.name === 'TimeoutError') errorCode = 'SOURCE_TIMEOUT';
    throw error;
  }
  if (check) output({ status: 200, type: 'application/json' }, '{"ok":true}');
  else {
    const headers = await response.allHeaders();
    const meta = {
      status: response.status(),
      type: headers['content-type']?.split(';')[0],
      challenge: headers['cf-mitigated'] === 'challenge',
    };
    if (meta.challenge || !response.ok()) output(meta);
    else if (meta.type !== 'application/json') output({ status: 502 });
    else {
      const body = await response.body();
      if (tooLarge || body.length > SHARE_MAX_BYTES) {
        errorCode = 'TOO_LARGE';
        throw new Error();
      }
      output(meta, body.toString('utf8'));
    }
  }
} catch {
  output({ error: timedOut ? 'SOURCE_TIMEOUT' : errorCode });
} finally {
  clearTimeout(timer);
  await stop();
}
