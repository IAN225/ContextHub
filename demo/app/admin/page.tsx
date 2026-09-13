'use client';
/* oxlint-disable nextjs/no-html-link-for-pages -- Admin navigation rechecks the current account. */
import { useCallback, useEffect, useState } from 'react';
import { getAccountStatus } from '@/lib/account/client';
import './admin.css';
type Member = {
  id: string;
  username: string;
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'rejected';
  created_at: number;
};
type Management = {
  revision: number;
  registrationOpen: boolean;
  users: Member[];
};
export default function AdminPage() {
  const [state, setState] = useState<Management | null>(null),
    [self, setSelf] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const load = useCallback(async () => {
    try {
      const status = await getAccountStatus();
      if (!status.user) {
        window.location.replace('/login');
        return;
      }
      if (status.user.role !== 'admin') throw Error('仅管理员可以访问此页面。');
      setSelf(status.user.id);
      const r = await fetch('/api/account/management', {
        headers: { 'X-Context-Hub': '1' },
      });
      const data = (await r.json()) as Management & { error?: string };
      if (!r.ok) throw Error(data.error);
      setState(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败。');
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);
  async function act(input: object) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await fetch('/api/account/management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Context-Hub': '1' },
        body: JSON.stringify({ ...input, revision: state?.revision }),
      });
      const data = (await r.json()) as Management & { error?: string };
      if (!r.ok) throw Error(data.error);
      const next = data as Management;
      if (next.users.find((u) => u.id === self)?.role !== 'admin') {
        window.location.assign('/');
        return;
      }
      setState(next);
      setMessage('设置已保存。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  }
  const admins =
    state?.users.filter((u) => u.role === 'admin' && u.status === 'active')
      .length ?? 0;
  return (
    <main className="admin-page">
      <nav>
        <a href="/">← 返回手账</a>
        <a href="/server">HTTPS 与证书设置 →</a>
      </nav>
      <header>
        <span className="login-eyebrow">CONTEXT HUB · ADMIN</span>
        <h1>用户与注册管理</h1>
        <p>审核新账号，管理注册入口与管理员权限。</p>
      </header>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {message && <output>{message}</output>}
      <button className="button" disabled={busy} onClick={() => void load()}>
        刷新列表
      </button>
      {!state && !error && <output>正在读取用户…</output>}
      {state && (
        <>
          <section className="admin-card">
            <h2>注册入口</h2>
            <p>
              {state.registrationOpen
                ? '注册申请已开放，新用户需等待管理员审批。'
                : '注册申请已关闭，已有账号可正常登录，待审批申请仍可处理。'}
            </p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void act({
                  action: 'registration',
                  open: !state.registrationOpen,
                })
              }
            >
              {state.registrationOpen ? '关闭注册申请' : '开放注册申请'}
            </button>
          </section>
          <section className="admin-card">
            <h2>待审批申请</h2>
            {state.users.filter((u) => u.status === 'pending').length === 0 ? (
              <p>暂无待审批申请。</p>
            ) : (
              <ul className="admin-applications">
                {state.users
                  .filter((u) => u.status === 'pending')
                  .map((u) => (
                    <li key={u.id}>
                      <div>
                        <strong>{u.username}</strong>
                        <small>{new Date(u.created_at).toLocaleString()}</small>
                      </div>
                      <div className="admin-actions">
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() =>
                            void act({
                              action: 'review',
                              userId: u.id,
                              approve: true,
                            })
                          }
                        >
                          批准 {u.username}
                        </button>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() =>
                            void act({
                              action: 'review',
                              userId: u.id,
                              approve: false,
                            })
                          }
                        >
                          拒绝 {u.username}
                        </button>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </section>
          <section className="admin-card">
            <h2>已注册用户</h2>
            <p>
              管理员可管理证书、注册申请和角色。至少保留一名管理员；角色变更立即生效。
            </p>
            <div className="admin-table">
              <table>
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>状态</th>
                    <th>角色</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {state.users
                    .filter((u) => u.status !== 'pending')
                    .map((u) => (
                      <tr key={u.id}>
                        <td>
                          {u.username}
                          {u.id === self ? '（当前账号）' : ''}
                        </td>
                        <td>{u.status === 'active' ? '已批准' : '已拒绝'}</td>
                        <td>{u.role === 'admin' ? '管理员' : '普通用户'}</td>
                        <td>
                          {u.status === 'active' && (
                            <button
                              className="button"
                              disabled={
                                busy || (u.role === 'admin' && admins <= 1)
                              }
                              onClick={() =>
                                void act({
                                  action: 'role',
                                  userId: u.id,
                                  role: u.role === 'admin' ? 'user' : 'admin',
                                })
                              }
                            >
                              {u.role === 'admin'
                                ? '设为普通用户'
                                : '设为管理员'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
