'use client';
import { useEffect, useState } from 'react';
import { accountAction, getAccountStatus } from '@/lib/account/client';
import './login.css';
export default function LoginPage() {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void getAccountStatus()
      .then((status) => {
        if (status.user || status.mode === 'local')
          window.location.replace('/');
      })
      .catch((failure) =>
        setError(failure instanceof Error ? failure.message : '读取失败。'),
      );
  }, []);
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-eyebrow">CONTEXT HUB</span>
        <h1>回到你的手账</h1>
        <p>登录后继续整理对话、笔记和记忆。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            void accountAction('login', { username: username.trim(), password })
              .then(() => window.location.assign('/'))
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
            disabled={busy || !username.trim() || !password}
          >
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>
        <small>暂未开放注册。创建账号或重置密码，请联系服务器管理员。</small>
      </section>
    </main>
  );
}
