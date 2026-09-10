import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { runBackgroundTasks } from './background-runner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const connection = fileURLToPath(
  new URL('../.env.summary.local', import.meta.url),
);
const runnerKey = randomBytes(32).toString('hex');
const runnerDirectory = fileURLToPath(
  new URL('../.wrangler/', import.meta.url),
);
mkdirSync(runnerDirectory, { recursive: true });
const runnerEnv = fileURLToPath(
  new URL('../.wrangler/task-runner.env', import.meta.url),
);
writeFileSync(runnerEnv, `CONTEXT_HUB_TASK_RUNNER_KEY=${runnerKey}\n`, {
  mode: 0o600,
});
const args = [
  '--import',
  new URL('./local-runtime.mjs', import.meta.url).href,
  fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  ),
  'dev',
  '--config',
  'dist/server/wrangler.json',
  '--persist-to',
  '.wrangler/state',
  '--ip',
  '127.0.0.1',
  '--port',
  '3000',
];
// Wrangler/Node both interpret env-file arguments; an absolute path avoids
// their different relative-directory rules on Windows.
if (existsSync(connection)) args.push('--env-file', connection);
const mcpConnection = fileURLToPath(
  new URL('../.env.mcp.local', import.meta.url),
);
if (
  process.env.CONTEXT_HUB_ENABLE_MCP_PUBLIC === '1' &&
  existsSync(mcpConnection)
)
  args.push('--env-file', mcpConnection);
args.push('--env-file', runnerEnv);
const dev = process.argv.includes('--dev');
const command = dev
  ? [
      fileURLToPath(
        new URL('../node_modules/vinext/dist/cli.js', import.meta.url),
      ),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3000',
    ]
  : args;
const lifecycle = new AbortController();
const child = spawn(process.execPath, command, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, CONTEXT_HUB_TASK_RUNNER_KEY: runnerKey },
});
void runBackgroundTasks('http://127.0.0.1:3000', runnerKey, lifecycle.signal);
child.on('exit', (code) => {
  lifecycle.abort();
  process.exitCode = code ?? 0;
});
child.on('error', () => {
  lifecycle.abort();
  console.error('无法启动本地服务。');
  process.exitCode = 1;
});
process.on('SIGINT', () => {
  lifecycle.abort();
  child.kill('SIGINT');
});
process.on('SIGTERM', () => {
  lifecycle.abort();
  child.kill('SIGTERM');
});
