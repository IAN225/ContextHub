'use client';
import { accountAction } from '@/lib/account/actions';
import { useState } from 'react';
import { useAccount } from '../../components/providers/account.tsx';
import { Button } from '../../components/shared/button.tsx';

export function AccountPanel({ saved = true }: { saved?: boolean }) {
  const { mode, user } = useAccount();
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  if (mode === 'local') return <p className="callout">账号服务未启用。</p>;
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          void accountAction('password', { password })
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
