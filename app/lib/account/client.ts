import { CLIENT_PROTOCOL } from '../storage/protocol.ts';
export type AccountUser = {
  id: string;
  username: string;
  role: 'admin' | 'user';
  mustChangePassword?: boolean;
  passwordSetupPending?: boolean;
};
export type PasswordRecovery = {
  available: boolean;
  path: string;
  command: string;
};
export class AccountActionError extends Error {
  constructor(
    message: string,
    public passwordRecovery?: PasswordRecovery,
  ) {
    super(message);
  }
}
export type AccountStatus = {
  mode: 'cloud' | 'local';
  user: AccountUser | null;
  activated?: boolean;
  registrationOpen?: boolean;
};
let loading: Promise<AccountStatus> | undefined;
let active: AccountStatus | undefined;
let boundUser: string | undefined;
export function getAccountStatus(): Promise<AccountStatus> {
  if (typeof window === 'undefined')
    return Promise.resolve({ mode: 'cloud', user: null });
  if (!loading)
    loading = fetch('/api/account/status', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('无法读取账号状态，请刷新重试。');
        return (await response.json()) as AccountStatus;
      })
      .then((status) => {
        active = status;
        if (status.user) bindAccountFetch(status.user.id);
        return status;
      })
      .catch((error) => {
        loading = undefined;
        throw error;
      });
  return loading;
}
export function cloudMode() {
  return active?.mode === 'cloud';
}
function bindAccountFetch(user: string) {
  if (boundUser) {
    if (boundUser !== user) throw new Error('账号已变化，请刷新页面。');
    return;
  }
  boundUser = user;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith('/api/')
    )
      return original(input, init);
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
    if (response.status === 426)
      window.dispatchEvent(new Event('account-version-changed'));
    if (response.status === 401)
      window.dispatchEvent(new Event('account-session-ended'));
    return response;
  };
}
