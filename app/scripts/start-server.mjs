import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSchema, recordSchema } from './schema-check.mjs';
import { openAccessStore } from './server/access-store.mjs';
import { openAccounts } from './server/accounts.mjs';
import { httpPort } from './server/http-port.mjs';
import { initializeOrigin } from './server/initialize-origin.mjs';
import { createRuntime, requireFreePort } from './server/runtime.mjs';
import { createServerService } from './server/service.mjs';
import { configureCaddy } from './server/tls.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(
  process.env.CONTEXT_HUB_SERVER_DATA_DIR || `${root}/.wrangler/server`,
);
checkSchema(dirname(directory), directory);
const webPort = httpPort(directory);
for (const port of [3000, 3001, 4080, 4310, webPort])
  await requireFreePort(port);
const store = await openAccessStore(directory);
const accounts = await openAccounts(directory, store.bootstrapAdmin);
const initialization = await accounts.initializeDeployment();
if (initialization.passwordFile)
  console.log(
    `初始管理员：admin。随机密码已写入 ${initialization.passwordFile}；首次管理员登录即激活，可保留当前密码。`,
  );
await initializeOrigin(store);
const runtime = createRuntime(root, directory, store.gatewayKey, () => {
  console.error('本机应用意外停止，服务器管理将退出以便系统服务重新启动。');
  process.exitCode = 1;
  void stop();
});
let ready = false;
const service = createServerService(store, runtime, {
  accounts,
  isReady: () => ready,
  maintenanceFile: resolve(directory, 'upgrade-maintenance'),
});
const publicServer = createServer(service.handler(false));
const setupServer = createServer(service.handler(true));
const webServer = createServer(service.handler(true, true));
let timer,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  ready = false;
  clearInterval(timer);
  // Let an in-progress configuration finish before stopping its application.
  await service.whenIdle();
  for (const server of [publicServer, setupServer, webServer]) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await runtime.stop();
  accounts.close();
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
    [webServer, webPort],
  ]) {
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(
        port,
        server === webServer ||
          (port === 4310 && process.env.CONTEXT_HUB_SETUP_BIND === '0.0.0.0')
          ? '0.0.0.0'
          : '127.0.0.1',
        resolve,
      );
    });
  }
  if (store.access?.mode === 'automatic') await configureCaddy([store.access]);
  recordSchema(dirname(directory));
  ready = true;
  timer = setInterval(() => {
    void service.check();
  }, 30 * 60000);
  timer.unref();
  console.log(
    `网页服务监听 0.0.0.0:${webPort}，浏览器访问 http://服务器IP:${webPort} 。`,
  );
  if (store.access) console.log(`HTTPS 访问地址：${store.access.origin}`);
} catch {
  console.error(
    '服务器启动失败，请检查应用构建、端口、数据目录和 Caddy 服务。',
  );
  await stop();
  process.exitCode = 1;
}
