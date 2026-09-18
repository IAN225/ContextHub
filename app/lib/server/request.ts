import { digest } from './crypto.ts';

// Business adapters choose their error type; the browser-origin policy is shared.
export function managementGuard(forbidden: (message: string) => Error) {
  return (request: Request) => {
    const site = request.headers.get('sec-fetch-site');
    if (
      request.headers.get('x-context-hub') !== '1' ||
      (site && !['same-origin', 'none'].includes(site))
    )
      throw forbidden('请从当前 Context Hub 页面操作。');
    const origin = request.headers.get('origin');
    if (
      (request.method !== 'GET' && !origin) ||
      (origin && origin !== new URL(request.url).origin)
    )
      throw forbidden('请求来源与当前页面不一致。');
  };
}

export async function sessionOwner<T>(
  request: Request,
  cookieName: string,
  lookup: (hash: string) => Promise<T>,
) {
  const value = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return undefined;
  return lookup(await digest(value));
}
