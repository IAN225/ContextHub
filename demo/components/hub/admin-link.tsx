'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAccount } from './account';
import { localRepository } from '@/lib/repository';
/** Flush account writes before leaving the journal; server routes also enforce the role. */
export function AdminLink({ saved }: { saved: boolean }) {
  const { mode, user } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (mode !== 'cloud' || user?.role !== 'admin') return null;
  return (
    <div className="admin-entry">
      <button
        className="admin-entry-button"
        disabled={busy || !saved}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await localRepository.flush?.();
            window.location.assign('/admin');
          } catch (e) {
            setError(e instanceof Error ? e.message : '保存失败，请重试。');
            setBusy(false);
          }
        }}
      >
        <ShieldCheck size={17} />
        <span>{busy ? '正在打开…' : '管理员设置'}</span>
      </button>
      {error && (
        <p role="alert" className="admin-entry-error">
          {error}
        </p>
      )}
    </div>
  );
}
