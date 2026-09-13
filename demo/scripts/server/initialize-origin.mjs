import { accessInput } from './tls.mjs';
export async function initializeOrigin(store, env = process.env) {
  if (store.access || !env.CONTEXT_HUB_DOMAIN) return;
  const mode = env.CONTEXT_HUB_HTTPS_MODE || 'automatic';
  if (mode === 'automatic' && env.CONTEXT_HUB_ACCEPT_ACME_TERMS !== 'true')
    throw new Error('自动证书需要设置 CONTEXT_HUB_ACCEPT_ACME_TERMS=true。');
  const access = accessInput({ origin: env.CONTEXT_HUB_DOMAIN, mode });
  await store.saveAccess({
    ...access,
    issuer: null,
    expiresAt: null,
    checkedAt: null,
  });
}
