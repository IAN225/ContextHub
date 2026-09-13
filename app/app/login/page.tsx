'use client';
/* oxlint-disable nextjs/no-html-link-for-pages -- Account navigation discards stale session state. */
import { useEffect, useState } from 'react';
import {
  accountAction,
  getAccountStatus,
  AccountActionError,
  type PasswordRecovery,
} from '@/lib/account/client';
import './login.css';
export default function LoginPage() {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState<PasswordRecovery>();
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [activated, setActivated] = useState(true);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void getAccountStatus()
      .then((status) => {
        setReady(true);
        setRegistrationOpen(!!status.registrationOpen);
        setActivated(status.activated !== false);
        if (status.user || status.mode === 'local')
          window.location.replace(
            status.user?.role === 'admin' && status.user.passwordSetupPending
              ? '/admin'
              : '/',
          );
      })
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : '读取失败。'),
      );
  }, []);
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-eyebrow">CONTEXT HUB</span>
        <h1>登录</h1>
        {!activated && <p>服务尚未激活，请使用初始管理员密码登录。</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            setRecovery(undefined);
            void accountAction('login', { username: username.trim(), password })
              .then((result) =>
                window.location.assign(
                  result.user?.role === 'admin' &&
                    result.user.passwordSetupPending
                    ? '/admin'
                    : '/',
                ),
              )
              .catch((failure) => {
                setError(
                  failure instanceof Error ? failure.message : '登录失败。',
                );
                if (failure instanceof AccountActionError)
                  setRecovery(failure.passwordRecovery);
              })
              .finally(() => setBusy(false));
          }}
        >
          <label>
            用户名
            <input
              disabled={!ready || busy}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={40}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              disabled={!ready || busy}
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="login-error">
              {error}
            </p>
          )}
          {recovery && username.trim().toLowerCase() === 'admin' && (
            <div className="login-recovery">
              {recovery.available ? (
                <>
                  <p>可在部署服务器上查看当前管理员密码：</p>
                  <code>{recovery.command}</code>
                  <small>密码文件：{recovery.path}</small>
                </>
              ) : (
                <p>
                  此旧实例尚无密码恢复文件。请按 README
                  的“忘记密码”步骤在服务器上重置；重置后会生成恢复文件。
                </p>
              )}
            </div>
          )}
          <button
            className="button primary"
            disabled={!ready || busy || !username.trim() || !password}
          >
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>
        {!ready && !error && <output>正在读取登录状态…</output>}
        {!ready && error && (
          <button className="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        )}
        {registrationOpen ? (
          <a href="/register">申请账号 · 需管理员审批</a>
        ) : (
          <small>注册申请暂未开放。账号问题请联系管理员。</small>
        )}
      </section>
    </main>
  );
}
