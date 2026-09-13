'use client';
import { useCallback, useEffect, useState } from 'react';
import { getAccountStatus } from './client';
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
export function useAccountManagement() {
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
  return { state, self, busy, error, message, load, act, admins };
}
