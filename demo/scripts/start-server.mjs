import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAccessStore } from './server/access-store.mjs';
import { createServerService } from './server/service.mjs';
import { createRuntime, requireFreePort } from './server/runtime.mjs';
import { configureCaddy } from './server/tls.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(
  process.env.CONTEXT_HUB_SERVER_DATA_DIR || `${root}/.wrangler/server`,
);
for (const port of [3000, 3001, 4080, 4310]) await requireFreePort(port);
const store = await openAccessStore(directory);
const runtime = createRuntime(root, directory, store.gatewayKey, () => {
  console.error('本机应用意外停止，服务器管理将退出以便系统服务重新启动。');
  process.exitCode = 1;
  void stop();
});
const service = createServerService(store, runtime);
const publicServer = createServer(service.handler(false));
const setupServer = createServer(service.handler(true));
let timer,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  // Let an in-progress configuration finish before stopping its application.
  await service.whenIdle();
  for (const server of [publicServer, setupServer]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await runtime.stop();
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void stop();
  });
try {
  await runtime.configure(store.access?.origin ?? null);
  for (const [server, port] of [
    [publicServer, 4080],
    [setupServer, 4310],
  ]) {
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  }
  if (store.access?.mode === 'automatic') await configureCaddy([store.access]);
  timer = setInterval(() => {
    void service.check();
  }, 30 * 60000);
  timer.unref();
  console.log(
    '服务器管理已启动。首次配置通过 SSH 转发访问 http://127.0.0.1:4310/server 。',
  );
  if (store.access) console.log(`HTTPS 访问地址：${store.access.origin}`);
} catch {
  console.error(
    '服务器启动失败，请检查应用构建、端口、数据目录和 Caddy 服务。',
  );
  await stop();
  process.exitCode = 1;
}
