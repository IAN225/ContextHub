import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBackgroundTasks } from './background-runner.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
if (
  !process.env.CONTEXT_HUB_SERVER_DATA_DIR ||
  process.env.CONTEXT_HUB_ACCOUNT_MODE !== '1'
)
  throw new Error('Start through the account server');
const key = randomBytes(32).toString('hex'),
  controller = new AbortController();
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: '3000',
    NODE_ENV: 'production',
    CONTEXT_HUB_TASK_RUNNER_KEY: key,
  },
});
void runBackgroundTasks(
  'http://127.0.0.1:3000',
  key,
  controller.signal,
  () =>
    !existsSync(
      join(process.env.CONTEXT_HUB_SERVER_DATA_DIR, 'upgrade-maintenance'),
    ),
);
child.on('exit', (code) => {
  controller.abort();
  process.exitCode = code ?? 1;
});
child.on('error', () => {
  controller.abort();
  console.error('Application failed to start');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    controller.abort();
    child.kill(signal);
  });
