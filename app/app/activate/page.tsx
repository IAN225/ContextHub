'use client';
import { useEffect, useState } from 'react';
import {
  accountAction,
  getAccountStatus,
  type AccountStatus,
} from '@/lib/account/client';
import '../login/login.css';
export default function ActivatePage() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [current, setCurrent] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void getAccountStatus()
      .then((s) => {
        if (!s.user) {
          window.location.replace('/login');
          return;
        }
        if (s.activated !== false && !s.user.mustChangePassword) {
          window.location.replace('/');
          return;
        }
        setStatus(s);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-eyebrow">CONTEXT HUB</span>
        <h1>激活你的 Context Hub</h1>
        <p>修改初始密码以激活服务。</p>
        {!status && <output>正在读取激活状态…</output>}
        {status?.user?.mustChangePassword && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              void accountAction('password', {
                currentPassword: current,
                password,
              })
                .then(() => window.location.assign('/login?activated=1'))
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <p>
              当前账号：<strong>{status.user.username}</strong>
            </p>
            <label>
              当前密码
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={256}
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
                maxLength={256}
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
            <small>
              至少 12 个字符，不能与初始密码相同。激活后请使用新密码重新登录。
            </small>
            <button
              className="button primary"
              disabled={
                busy ||
                password.length < 12 ||
                password !== confirmation ||
                password === current
              }
            >
              {busy ? '正在激活…' : '修改密码并激活'}
            </button>
          </form>
        )}
        {status?.user && !status.user.mustChangePassword && (
          <p>请等待初始管理员完成激活。</p>
        )}
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        {status?.user && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              void accountAction('logout')
                .then(() => window.location.assign('/login'))
                .catch((e) => setError(e.message));
            }}
          >
            退出登录
          </button>
        )}
      </section>
    </main>
  );
}
