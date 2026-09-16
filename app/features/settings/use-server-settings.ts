'use client';
import { getAccountStatus } from '@/lib/account/client';
import { useCallback, useEffect, useState } from 'react';
import type { ServerStatus } from './server-contracts.ts';

export function useServerSettings() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [origin, setOrigin] = useState(''),
    [mode, setMode] = useState('automatic');
  const [terms, setTerms] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    try {
      const account = await getAccountStatus();
      if (account.mode === 'cloud' && !account.user) {
        window.location.replace('/login');
        return;
      }
      const response = await fetch('/api/server/status', { cache: 'no-store' });
      if (response.status === 404) {
        setStatus({ enabled: false });
        return;
      }
      if (!response.ok)
        throw new Error(
          '无法读取服务器状态，请通过原地址或 SSH 本机入口检查。',
        );
      setStatus(await response.json());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '读取状态失败。');
    }
  }, []);
  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);
  const hasPending = !!status?.pending;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      void load();
    }, 2500);
    return () => clearInterval(timer);
  }, [hasPending, load]);
  async function action(name: string, input: object = {}) {
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const response = await fetch(`/api/server/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Context-Hub-Server': '1',
        },
        body: JSON.stringify(input),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error)
        throw new Error(result.error || '操作未完成。');
      if (name === 'check') setFeedback('连接正常');
      setPassword('');
      setConfirmation('');
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '操作失败。');
    } finally {
      setBusy(false);
    }
  }
  let changingOrigin = false;
  try {
    changingOrigin =
      !!status?.access &&
      new URL(origin.includes('://') ? origin : `https://${origin}`).origin !==
        status.access.origin;
  } catch {
    /* The server reports invalid addresses when submitted. */
  }
  return {
    status,
    password,
    setPassword,
    confirmation,
    setConfirmation,
    origin,
    setOrigin,
    mode,
    setMode,
    terms,
    setTerms,
    busy,
    error,
    feedback,
    load,
    action,
    changingOrigin,
  };
}
