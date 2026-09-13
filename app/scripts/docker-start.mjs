import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const run = (args) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { stdio: 'inherit' });
    p.once('error', reject);
    p.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('数据库迁移失败。')),
    );
  });
if (process.env.CONTEXT_HUB_WAIT_FOR_CADDY === 'true') {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:2019/config/', {
        signal: AbortSignal.timeout(1000),
        headers: { Origin: 'http://127.0.0.1:2019' },
      });
      await r.body?.cancel();
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* sidecar starting */
    }
    await delay(1000);
  }
  if (!ready) throw new Error('Caddy 未能启动，请检查 compose logs caddy。');
}
await run([
  '--import',
  './scripts/local-runtime.mjs',
  './node_modules/wrangler/bin/wrangler.js',
  'd1',
  'migrations',
  'apply',
  'DB',
  '--local',
  '--config',
  'dist/server/wrangler.json',
  '--persist-to',
  '.wrangler/state',
]);
await import('./start-server.mjs');
