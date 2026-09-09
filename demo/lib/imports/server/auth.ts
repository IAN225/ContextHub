import { ImportError } from '../contracts.ts';
import type { ImportRepository } from './repository.ts';

const SESSION_COOKIE = 'context_hub_import_session';
export async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export function randomSecret(prefix: string) {
  return (
    prefix +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
  );
}
export function requireManagementRequest(request: Request) {
  const site = request.headers.get('sec-fetch-site');
  if (
    request.headers.get('x-context-hub') !== '1' ||
    (site && !['same-origin', 'none'].includes(site))
  )
    throw new ImportError('FORBIDDEN', '请从当前 Context Hub 页面操作。', 403);
  const origin = request.headers.get('origin');
  if (
    (request.method !== 'GET' && !origin) ||
    (origin && origin !== new URL(request.url).origin)
  )
    throw new ImportError('FORBIDDEN', '请求来源与当前页面不一致。', 403);
}
export async function managementOwner(
  request: Request,
  repo: ImportRepository,
) {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return null;
  return repo.findOwner(await digest(value));
}
export async function deliveryOwner(request: Request, repo: ImportRepository) {
  const key =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.headers.get('x-api-key');
  if (!key || !/^ch_delivery_[a-f0-9]{64}$/.test(key))
    throw new ImportError(
      'INVALID_KEY',
      '请提供有效的 Context Hub 投递 Key。',
      401,
    );
  const owner = await repo.findDeliveryOwner(await digest(key));
  if (!owner)
    throw new ImportError('INVALID_KEY', '投递 Key 无效或已吊销。', 401);
  return owner;
}
export function sessionCookie(value: string, request: Request) {
  return `${SESSION_COOKIE}=${value}; Path=/api/imports; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
