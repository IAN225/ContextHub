'use client';
/* oxlint-disable nextjs/no-html-link-for-pages -- Account navigation discards stale session state. */
import { useEffect, useState } from 'react';
import { accountAction, getAccountStatus } from '@/lib/account/client';
import './login.css';
export default function LoginPage() {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
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
            status.user?.mustChangePassword || status.activated === false
              ? '/activate'
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
            void accountAction('login', { username: username.trim(), password })
              .then((result) =>
                window.location.assign(
                  result.user?.mustChangePassword || !activated
                    ? '/activate'
                    : '/',
                ),
              )
              .catch((failure) =>
                setError(
                  failure instanceof Error ? failure.message : '登录失败。',
                ),
              )
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
