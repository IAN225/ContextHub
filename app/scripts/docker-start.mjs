import { setTimeout as delay } from 'node:timers/promises';
import { checkSchema } from './schema-check.mjs';
checkSchema();
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
await import('./start-server.mjs');
