import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const connection = fileURLToPath(
  new URL('../.env.summary.local', import.meta.url),
);
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
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
child.on('error', () => {
  console.error('无法启动本地服务。');
  process.exitCode = 1;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
