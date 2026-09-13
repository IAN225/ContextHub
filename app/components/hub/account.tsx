'use client';
/* oxlint-disable nextjs/no-html-link-for-pages -- Auth boundaries require document navigation to discard anonymous route caches. */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  accountAction,
  getAccountStatus,
  type AccountStatus,
} from '@/lib/account/client';
import { Button } from './shared';
const AccountContext = createContext<AccountStatus>({
  mode: 'local',
  user: null,
});
export const useAccount = () => useContext(AccountContext);
export function AccountBoundary({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
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
    window.addEventListener('account-session-ended', ended);
    return () => {
      alive = false;
      window.removeEventListener('account-session-ended', ended);
    };
  }, []);
  if (!status)
    return (
      <main className="account-loading">
        <p role={error ? 'alert' : undefined}>{error || '正在打开手账…'}</p>
        {error && (
          <Button onClick={() => window.location.reload()}>重新加载</Button>
        )}
      </main>
    );
  return (
    <AccountContext.Provider value={status}>
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
export function AccountPanel({ saved = true }: { saved?: boolean }) {
  const { mode, user } = useAccount();
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (mode === 'local')
    return (
      <p className="callout">
        当前为本地模式，手账保存在此浏览器。服务器部署后可使用云端账号。
      </p>
    );
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await accountAction('logout');
      window.location.assign('/login');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '退出失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-panel">
      <p>
        <strong>{user?.username}</strong> ·{' '}
        {user?.role === 'admin' ? '管理员' : '普通用户'}
      </p>
      <p className="callout">
        手账、附件、草稿、偏好和连接配置保存在你的云端账号中。其他设备登录后可继续使用。
      </p>
      {user?.role === 'admin' && (
        <p>
          <a href="/admin">用户与注册管理 →</a>
          <br />
          <a href="/server">服务器管理与 HTTPS 设置 →</a>
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void accountAction('password', { currentPassword: current, password })
            .then(() => window.location.assign('/login'))
            .catch((failure) =>
              setError(
                failure instanceof Error ? failure.message : '修改失败。',
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        <h3>修改密码</h3>
        <label>
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={256}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          确认新密码
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <small>至少 12 个字符。修改后所有设备需要重新登录。</small>
        <button
          className="button"
          disabled={busy || !saved || password !== confirmation}
        >
          保存新密码
        </button>
      </form>
      {!saved && <output>请先保存当前修改，再退出或修改密码。</output>}
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy || !saved} onClick={() => void logout()}>
        退出登录
      </Button>
    </div>
  );
}
