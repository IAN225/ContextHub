'use client';
import { useState } from 'react';
import { accountAction } from '../../lib/account/actions.ts';

export function AdminPasswordSetup() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(keep: boolean) {
    setBusy(true);
    setError('');
    try {
      await accountAction(
        keep ? 'keep-password' : 'password',
        keep ? {} : { password },
      );
      window.location.assign(keep ? '/admin' : '/login');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-card">
      <h2>密码设置</h2>
      <p>服务已激活。可以保留当前密码，或设置新密码。</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
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
        {error && <p role="alert">{error}</p>}
        <div className="form-actions">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => void submit(true)}
          >
            保留当前密码
          </button>
          <button
            className="button primary"
            disabled={busy || !password || password !== confirmation}
          >
            保存新密码
          </button>
        </div>
      </form>
    </section>
  );
}
