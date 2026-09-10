import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createMcpGateway } from './mcp-gateway.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Refuse to replace an existing local server or occupy a port through a race.
async function free(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
await free(3000).catch(() => {
  throw new Error(
    '3000 端口已占用。请先停止原本的 Context Hub 服务，再启动 ChatGPT 联调。',
  );
});
await free(3001);
const bundled = fileURLToPath(
  new URL('../.wrangler/bin/cloudflared.exe', import.meta.url),
);
const executable = existsSync(bundled) ? bundled : 'cloudflared';
const key = randomBytes(32).toString('hex');
let gateway,
  app,
  started = false,
  stopping = false;
const tunnel = spawn(
  executable,
  [
    'tunnel',
    '--no-autoupdate',
    '--protocol',
    'http2',
    '--url',
    'http://127.0.0.1:3001',
  ],
  { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
const deadline = setTimeout(() => {
  console.error('HTTPS 测试入口未能建立。');
  stop();
}, 60000);
function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(deadline);
  // The wrapper alone cannot clean up Wrangler/workerd on Windows.
  // Stop only the child process tree started by this command.
  if (app?.pid && process.platform === 'win32')
    execFile(
      'taskkill',
      ['/PID', String(app.pid), '/T', '/F'],
      { windowsHide: true },
      () => {},
    );
  else app?.kill();
  tunnel.kill();
  gateway?.closeAllConnections();
  gateway?.close();
}
function output(chunk) {
  const line = String(chunk);
  const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!match || started) return;
  started = true;
  clearTimeout(deadline);
  const origin = match[0];
  gateway = createMcpGateway({ origin, key });
  gateway.once('error', () => {
    console.error('无法启动 MCP 网关。');
    stop();
  });
  gateway.listen(3001, '127.0.0.1', () => {
    mkdirSync(new URL('../.wrangler/', import.meta.url), { recursive: true });
    writeFileSync(
      new URL('../.env.mcp.local', import.meta.url),
      `CONTEXT_HUB_MCP_PUBLIC_ORIGIN=${origin}\nCONTEXT_HUB_MCP_GATEWAY_KEY=${key}\n`,
      { mode: 0o600 },
    );
    app = spawn(process.execPath, ['scripts/start-local.mjs'], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit',
      env: { ...process.env, CONTEXT_HUB_ENABLE_MCP_PUBLIC: '1' },
    });
    app.once('exit', () => stop());
    app.once('error', () => {
      console.error('无法启动手账服务。');
      stop();
    });
    console.log(
      `ChatGPT HTTPS 联调入口：${origin}\n请打开 http://127.0.0.1:3000，在目标手账的连接设置中准备连接。\n关闭此进程会停止联调；重新启动后地址会改变，需要重新连接。`,
    );
  });
}
tunnel.stdout.on('data', output);
tunnel.stderr.on('data', output);
tunnel.once('error', () => {
  console.error('未找到 cloudflared，请按 docs/mcp.md 安装后重试。');
  stop();
  process.exitCode = 1;
});
tunnel.once('exit', () => {
  if (!started) console.error('HTTPS 隧道建立失败。');
  stop();
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
