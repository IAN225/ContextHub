'use client';
import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { Button, Modal } from './shared';
import type { HubState } from '@/lib/hub-state';
import { localRepository } from '@/lib/repository';
import {
  BACKUP_LIMIT,
  backupCounts,
  backupState,
  createBackup,
  parseBackup,
  restoreBackup,
  type HubBackup,
} from '@/lib/backup';
import { trashCounts } from '@/lib/recycle-bin';
import { taskRequest } from '@/lib/tasks/client';

function download(backup: HubBackup, prefix = 'ContextHub备份') {
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > BACKUP_LIMIT)
    throw new Error('备份超过 100 MB，暂不能导出。');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
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
  const [backup, setBackup] = useState<HubBackup | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const counts = state ? trashCounts(state) : { total: 0, expired: 0 };
  const imported = backup ? backupCounts(backupState(backup)) : null;
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
      title="本地数据"
      description="备份、恢复与回收站"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="form-stack">
        <section className="form-stack">
          <h3>备份与恢复</h3>
          <p className="inline-note">
            导出已保存的手账、Note、摘要、待归档内容、草稿和本地附件。不包含模型
            Key、投递凭据及服务端尚未收取的队列。
          </p>
          <Button
            disabled={busy || !state || !saved}
            onClick={() =>
              void run(async () => {
                download(await createBackup(localRepository));
                setMessage('已发起备份下载。');
              })
            }
          >
            <Download size={15} />
            导出备份
          </Button>
          {!saved && state && (
            <p className="inline-note">
              请先等待保存完成；保存失败时可关闭此窗口重试保存。
            </p>
          )}
          <label className="field">
            选择备份文件（JSON，最多 100 MB）
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                setBackup(null);
                setConfirmed(false);
                if (!file) return;
                void run(async () => {
                  if (file.size > BACKUP_LIMIT)
                    throw new Error('备份超过 100 MB。');
                  setBackup(parseBackup(await file.text()));
                });
              }}
            />
          </label>
          {backup && imported && (
            <div className="form-stack">
              <p className="callout">
                备份时间：{new Date(backup.createdAt).toLocaleString()}
                <br />
                {imported.workspaces} 本手账 · {imported.turns} 轮原文 ·{' '}
                {imported.notes} 条 Note · {imported.uploads} 份待归档内容
              </p>
              <p className="inline-note">
                恢复会覆盖此浏览器的现有数据，并自动刷新。
                {state
                  ? '覆盖前会发起当前数据的备份下载；'
                  : '当前数据读取失败，无法生成覆盖前备份；'}
                摘要自动运行和自动收件会暂停，回收站内容获得新的 30
                天恢复期。现有后台任务及未接收结果会取消，不包含在备份中。恢复后可重新启用收件。
              </p>
              <label className="checks">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>我确认用此备份覆盖本地数据</span>
              </label>
              <Button
                primary
                disabled={busy || !confirmed || (Boolean(state) && !saved)}
                onClick={() =>
                  void run(async () => {
                    if (state)
                      download(
                        await createBackup(localRepository),
                        'ContextHub恢复前备份',
                      );
                    // Cancel retained server snapshots before replacing their source
                    // data, so old work cannot keep running against a restored library.
                    await taskRequest('session', {});
                    await taskRequest('cancel-all', {});
                    await restoreBackup(localRepository, backup);
                    window.location.reload();
                  })
                }
              >
                确认覆盖并恢复
              </Button>
            </div>
          )}
        </section>
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
            <Button
              disabled={busy || !saved || !counts.expired}
              onClick={() =>
                void run(async () => {
                  setMessage(
                    `已清理 ${await onCleanup('expired')} 项到期内容。`,
                  );
                })
              }
            >
              清理到期内容
            </Button>
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
