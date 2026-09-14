'use client';
/* oxlint-disable nextjs/no-html-link-for-pages -- Admin navigation rechecks the current account. */
import { AdminPasswordSetup } from './password-setup';
import { useAccountManagement } from '@/lib/account/use-management';
export function AdminSettings() {
  const {
    state,
    loading,
    self,
    busy,
    error,
    message,
    load,
    act,
    admins,
    passwordSetupPending,
  } = useAccountManagement();
  return (
    <main className="admin-page">
      <nav>
        <a href="/">← 返回工作区</a>
        {state && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void load()}
          >
            刷新列表
          </button>
        )}
      </nav>
      <header>
        <span className="login-eyebrow">CONTEXT HUB</span>
        <h1>设置</h1>
      </header>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {message && <output>{message}</output>}
      <section
        className="admin-card preferences-placeholder"
        aria-label="偏好设置"
      >
        <h2>偏好</h2>
      </section>
      {loading && !error && <output>正在读取设置…</output>}
      {passwordSetupPending && <AdminPasswordSetup />}
      {state && (
        <>
          <section className="admin-card">
            <h2>HTTPS 与证书</h2>
            <p>查看访问域名、证书状态和自动续期，或调整 HTTPS 入口。</p>
            <a className="button" href="/server">
              打开证书设置 →
            </a>
          </section>
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
