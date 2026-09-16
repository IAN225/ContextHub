import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { configureCaddy, probeHttps, resolvePublicHost } from './tls.mjs';
export function createAccessController(store, runtime, options = {}) {
  const publicPort = options.publicPort ?? 4080;
  const caddy =
    options.caddy ?? ((access) => configureCaddy(access, publicPort));
  const resolve = options.resolve ?? resolvePublicHost;
  const probe = options.probe ?? probeHttps;
  let pending = null,
    error = '',
    idle = Promise.resolve();
  const challenges = new Set();

  const status = () => ({
    access: store.access,
    pending: pending && {
      mode: pending.mode,
      origin: pending.origin,
      phase: pending.phase,
    },
    error,
  });
  async function apply(next) {
    const previous = store.access;
    const usesCaddy =
      previous?.mode === 'automatic' || next.mode === 'automatic';
    const nonce = randomBytes(32).toString('hex');
    challenges.add(nonce);
    let runtimeChanged = false;
    try {
      await resolve(next.origin);
      pending.phase = '正在配置 HTTPS';
      if (usesCaddy) await caddy([previous, next].filter(Boolean));
      pending.phase = '正在验证证书与服务地址';
      let certificate;
      for (
        let attempt = 0;
        attempt < (options.probeAttempts ?? 12);
        attempt++
      ) {
        try {
          certificate = await probe(next.origin, nonce);
          break;
        } catch (failure) {
          if (attempt === (options.probeAttempts ?? 12) - 1) throw failure;
          await delay(options.retryDelay ?? 3000);
        }
      }
      pending.phase = '正在启用访问地址';
      runtimeChanged = true;
      await runtime.configure(next.origin);
      await store.saveAccess({ ...next, ...certificate });
      // A cleanup failure must not undo a successfully saved and reachable origin.
      if (usesCaddy) {
        try {
          await caddy([next]);
        } catch {
          error = '新地址已启用，但旧代理配置未清理，请检查 Caddy 服务。';
        }
      }
    } catch (failure) {
      error = failure.message || '配置失败，原访问地址已保留。';
      if (runtimeChanged) {
        try {
          await runtime.configure(previous?.origin ?? null);
        } catch {
          error += ' 应用恢复失败，请通过 SSH 检查服务。';
        }
      }
      if (usesCaddy) {
        try {
          await caddy(previous ? [previous] : []);
        } catch {
          error += ' 代理恢复失败，请通过 SSH 检查 Caddy。';
        }
      }
    } finally {
      challenges.delete(nonce);
      pending = null;
    }
  }
  function begin(next) {
    if (pending) throw new Error('正在处理上一次配置，请稍候。');
    if (
      store.access?.origin === next.origin &&
      store.access?.mode === next.mode
    )
      throw new Error('当前地址已启用，可使用“检查连接”更新状态。');
    if (
      store.access?.origin === next.origin &&
      store.access?.mode === 'automatic' &&
      next.mode === 'external'
    )
      throw new Error(
        '同一域名从自动证书迁移至外部代理需要通过 SSH 操作，请先完成代理迁移。',
      );
    error = '';
    pending = { ...next, phase: '正在检查域名' };
    idle = apply(next);
  }
  async function check() {
    if (pending || !store.access) return;
    const current = store.access;
    const nonce = randomBytes(32).toString('hex');
    challenges.add(nonce);
    try {
      const certificate = await probe(current.origin, nonce);
      if (!pending && store.access?.origin === current.origin)
        await store.saveAccess({ ...current, ...certificate });
      error = '';
    } catch {
      error =
        'HTTPS 检查失败，请检查证书续期、网络与反向代理。当前配置未更改。';
    } finally {
      challenges.delete(nonce);
    }
  }

  return { status, check, begin, challenges, whenIdle: () => idle };
}
