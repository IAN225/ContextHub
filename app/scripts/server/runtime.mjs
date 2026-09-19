import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createMcpGateway } from '../mcp-gateway.mjs';

export async function requireFreePort(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () =>
      reject(new Error(`${port} 端口已占用，请先停止此项目的旧服务。`)),
    );
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}

export function createRuntime(root, directory, key, onFailure = () => {}) {
  let child = null,
    gateway = null;
  async function stop() {
    if (gateway) {
      const current = gateway;
      gateway = null;
      current.closeAllConnections();
      await new Promise((resolve) => current.close(resolve));
    }
    if (child) {
      const current = child;
      child = null;
      if (current.exitCode === null && current.signalCode === null) {
        if (process.platform === 'win32') {
          await new Promise((resolve) =>
            spawn('taskkill', ['/PID', String(current.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            }).once('exit', resolve),
          );
        } else {
          const exited = new Promise((resolve) =>
            current.once('exit', resolve),
          );
          // The application and task runner children have a dedicated process group.
          try {
            process.kill(-current.pid, 'SIGTERM');
          } catch {
            /* Already stopped. */
          }
          let timer;
          try {
            await Promise.race([
              exited,
              new Promise((resolve) => {
                timer = setTimeout(() => {
                  try {
                    process.kill(-current.pid, 'SIGKILL');
                  } catch {
                    /* Already stopped. */
                  }
                  resolve();
                }, 10000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
      }
    }
  }
  async function configure(origin) {
    await stop();
    child = spawn(process.execPath, ['scripts/start-application.mjs'], {
      cwd: root,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: 'inherit',
      env: {
        ...process.env,
        CONTEXT_HUB_ENABLE_MCP_PUBLIC: '1',
        CONTEXT_HUB_SERVER_DATA_DIR: directory,
        CONTEXT_HUB_ACCOUNT_MODE: '1',
        CONTEXT_HUB_MCP_PUBLIC_ORIGIN: origin ?? '',
        CONTEXT_HUB_MCP_GATEWAY_KEY: key,
      },
    });
    let failure = false,
      ready = false;
    const started = child;
    const failed = () => {
      failure = true;
      if (ready && child === started) onFailure();
    };
    child.once('error', failed);
    child.once('exit', failed);
    for (let attempt = 0; attempt < 60; attempt++) {
      if (failure) throw new Error('本机应用启动失败，请查看服务日志。');
      let healthy = false;
      try {
        const response = await fetch('http://127.0.0.1:3000/', {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        healthy = response.ok;
      } catch {
        /* Wait for the application to become ready. */
      }
      if (healthy && !failure) {
        if (origin) {
          gateway = createMcpGateway({ origin, key });
          await new Promise((resolve, reject) => {
            gateway.once('error', reject);
            gateway.listen(3001, '127.0.0.1', resolve);
          });
        }
        if (failure) throw new Error('本机应用启动失败，请查看服务日志。');
        ready = true;
        return;
      }
      await delay(500);
    }
    throw new Error('应用启动超时，请查看服务器日志。');
  }
  return { configure, stop };
}
