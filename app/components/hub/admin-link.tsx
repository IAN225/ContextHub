'use client';
import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useAccount } from './account';
import { accountRepository } from '@/lib/repository';
/** Flush account writes before leaving the journal; server routes also enforce the role. */
export function AdminLink({ saved }: { saved: boolean }) {
  const { mode } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (mode !== 'cloud') return null;
  return (
    <div className="admin-entry">
      <button
        className="admin-entry-button"
        disabled={busy || !saved}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await accountRepository.flush?.();
            window.location.assign('/settings');
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存失败，请重试。');
            setBusy(false);
          }
        }}
      >
        <Settings2 size={17} />
        <span>{busy ? '正在打开…' : '设置'}</span>
      </button>
      {error && (
        <p role="alert" className="admin-entry-error">
          {error}
        </p>
      )}
    </div>
  );
}
