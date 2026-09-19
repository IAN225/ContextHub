import { CLIENT_PROTOCOL } from '../storage/protocol.ts';
export function accountFetch(
  original: typeof fetch,
  user: string,
  origin: string,
  invalidated: (reason: 'expired' | 'outdated') => void,
): typeof fetch {
  let blocked = '';
  return async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      origin,
    );
    if (url.origin !== origin || !url.pathname.startsWith('/api/'))
      return original(input, init);
    if (blocked) throw new Error(blocked);
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    headers.set('X-Context-Hub-User', user);
    headers.set('X-Context-Hub-Version', CLIENT_PROTOCOL);
    const response = await original(input, {
      ...init,
      headers,
      cache: 'no-store',
    });
    if (blocked) throw new Error(blocked);
    const changed =
      response.status === 409 &&
      (
        await response
          .clone()
          .json()
          .catch(() => ({}))
      ).error === '登录账号已变化，请刷新页面。';
    if (response.status === 401 || changed || response.status === 426) {
      const outdated = response.status === 426;
      blocked = outdated
        ? '服务已升级，请保留草稿后刷新页面。'
        : '登录状态已变化，请保留草稿后重新登录。';
      invalidated(outdated ? 'outdated' : 'expired');
    }
    return response;
  };
}
