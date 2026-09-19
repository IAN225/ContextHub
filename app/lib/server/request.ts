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
