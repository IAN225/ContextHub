import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const entry =
  process.argv[2] === 'initialize'
    ? 'initialize-server.mjs'
    : 'start-server.mjs';
const child = spawn(
  process.execPath,
  [resolve(root, 'production/scripts', entry)],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      CONTEXT_HUB_SERVER_DATA_DIR:
        process.env.CONTEXT_HUB_SERVER_DATA_DIR ||
        resolve(root, '.wrangler/server'),
    },
  },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => child.kill(signal));
