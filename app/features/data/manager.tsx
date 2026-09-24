'use client';
import { BackupPanel } from './backup-panel.tsx';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import { trashCounts } from '../../lib/recycle-bin.ts';
import { type HubState } from '../../lib/state/contracts.ts';

export function DataManager({
  state,
  saved,
  onClose,
  onCleanup,
}: {
  state?: HubState;
  saved: boolean;
  onClose: () => void;
  onCleanup: (mode: 'expired' | 'all') => Promise<number>;
}) {
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const counts = state ? trashCounts(state) : { total: 0, expired: 0 };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : '操作未完成，当前数据未修改。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="数据管理"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="form-stack">
        <BackupPanel
          state={state}
          saved={saved}
          busy={busy}
          run={run}
          setMessage={setMessage}
        />
        {state && (
          <section className="form-stack">
            <h3>回收站</h3>
            <p className="inline-note">
              共 {counts.total} 项原文和 Note，其中 {counts.expired} 项已满 30
              天。到期内容会在打开应用、返回窗口或定时检查时清理。删除时间缺失的旧记录保留，直到手动清空。
            </p>
            <p className="inline-note">
              清理会删除原文附件、Note
              历史和对应编辑草稿；已经写入摘要的文字不会随之重写。
            </p>
            {counts.total > 0 && (
              <>
                <label className="checks">
                  <input
                    type="checkbox"
                    checked={clearConfirmed}
                    disabled={busy}
                    onChange={(event) =>
                      setClearConfirmed(event.target.checked)
                    }
                  />
                  <span>永久删除回收站全部 {counts.total} 项，无法撤销</span>
                </label>
                <Button
                  disabled={busy || !saved || !clearConfirmed}
                  onClick={() =>
                    void run(async () => {
                      setMessage(
                        `已永久删除 ${await onCleanup('all')} 项内容。`,
                      );
                      setClearConfirmed(false);
                    })
                  }
                >
                  <Trash2 size={15} />
                  清空回收站
                </Button>
              </>
            )}
          </section>
        )}
        {busy && <output>正在处理，请稍候…</output>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {message && <output>{message}</output>}
      </div>
    </Modal>
  );
}
