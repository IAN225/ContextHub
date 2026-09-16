/* oxlint-disable nextjs/no-html-link-for-pages -- Auth boundaries require document navigation to discard anonymous route caches. */
'use client';
import { getAccountStatus, type AccountStatus } from '@/lib/account/client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Button } from '../shared/button.tsx';

const AccountContext = createContext<AccountStatus>({
  mode: 'local',
  user: null,
});

export const useAccount = () => useContext(AccountContext);

export function AccountBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [outdated, setOutdated] = useState(false);
  useEffect(() => {
    let alive = true;
    void getAccountStatus()
      .then((result) => {
        if (!alive) return;
        if (result.mode === 'cloud' && !result.user) {
          window.location.replace('/login');
          return;
        }
        if (
          result.user &&
          (result.user.mustChangePassword || result.activated === false)
        ) {
          window.location.replace('/activate');
          return;
        }
        setStatus(result);
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error ? failure.message : '账号读取失败。',
          );
      });
    const ended = () => setExpired(true);
    const versionChanged = () => setOutdated(true);
    window.addEventListener('account-version-changed', versionChanged);
    window.addEventListener('account-session-ended', ended);
    return () => {
      alive = false;
      window.removeEventListener('account-session-ended', ended);
      window.removeEventListener('account-version-changed', versionChanged);
    };
  }, []);
  if (!status)
    return (
      <main className="account-loading">
        <p role={error ? 'alert' : undefined}>{error || '正在打开工作区…'}</p>
        {error && (
          <Button onClick={() => window.location.reload()}>重新加载</Button>
        )}
      </main>
    );
  return (
    <AccountContext.Provider value={status}>
      {outdated && (
        <aside className="account-session-alert" role="alert">
          服务已升级，保存已暂停。请先复制未保存内容，再刷新页面。{' '}
          <button onClick={() => window.location.reload()}>刷新页面</button>
        </aside>
      )}
      {expired && (
        <aside className="account-session-alert" role="alert">
          登录已失效，云端保存已暂停。请先复制未保存的内容，再打开登录页。{' '}
          <a href="/login">重新登录</a>
        </aside>
      )}
      {children}
    </AccountContext.Provider>
  );
}
