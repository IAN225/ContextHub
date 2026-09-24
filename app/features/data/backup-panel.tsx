'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import type { HubState } from '../../lib/state/contracts.ts';
import { accountRepository } from '../../lib/storage/account-repository.ts';
import {
  BACKUP_LIMIT,
  backupCounts,
  backupState,
  createBackup,
  parseBackup,
  restoreBackup,
  type HubBackup,
} from '../../lib/storage/backup.ts';
import {
  importBackupWorkspaces,
  selectBackupWorkspaces,
} from '../../lib/storage/workspace-backup.ts';
import { taskRequest } from '../../lib/tasks/client.ts';
import { mcpRequest } from '../../lib/mcp/client.ts';

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
function WorkspaceSelection({
  label,
  workspaces,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  workspaces: HubState['workspaces'];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="form-stack backup-workspaces" disabled={disabled}>
      <legend>
        {label}（已选 {selected.length} / {workspaces.length}）
      </legend>
      <label className="checks">
        <input
          type="checkbox"
          checked={
            workspaces.length > 0 &&
            workspaces.every((w) => selected.includes(w.id))
          }
          disabled={!workspaces.length}
          onChange={(e) =>
            onChange(e.target.checked ? workspaces.map((w) => w.id) : [])
          }
        />
        <span>全选工作区</span>
      </label>
      {workspaces.map((w) => (
        <label className="checks" key={w.id}>
          <input
            type="checkbox"
            checked={selected.includes(w.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, w.id]
                  : selected.filter((id) => id !== w.id),
              )
            }
          />
          <span>
            {w.name} · {w.turns.length} 轮原文 · {w.notes.length} 条 Note
          </span>
        </label>
      ))}
      {!workspaces.length && <p className="inline-note">没有工作区。</p>}
    </fieldset>
  );
}
export function BackupPanel({
  state,
  saved,
  busy,
  run,
  setMessage,
}: {
  state?: HubState;
  saved: boolean;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  setMessage: (message: string) => void;
}) {
  const [exportIds, setExportIds] = useState(
    () => state?.workspaces.map((w) => w.id) ?? [],
  );
  const [backup, setBackup] = useState<HubBackup | null>(null);
  const [importIds, setImportIds] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const imported = backup ? backupState(backup) : null;
  const selected = imported
    ? imported.workspaces.filter((w) => importIds.includes(w.id))
    : [];
  const counts = imported
    ? backupCounts({
        ...imported,
        workspaces: selected,
        uploads: imported.uploads.filter(
          (u) => u.workspaceId && importIds.includes(u.workspaceId),
        ),
      })
    : null;
  return (
    <section className="form-stack backup-panel">
      <h3>备份与恢复</h3>
      <p className="inline-note">
        工作区备份包含所选工作区的原文、Note、摘要、记忆包、草稿、已保存附件及关联收件。不包含未归属收件、账号偏好、模型
        Key、投递凭据或 MCP 令牌。MCP 写入需先在网页接收。
      </p>
      {state && (
        <WorkspaceSelection
          label="选择导出的工作区"
          workspaces={state.workspaces}
          selected={exportIds}
          onChange={setExportIds}
          disabled={busy}
        />
      )}
      <Button
        disabled={busy || !state || !saved || !exportIds.length}
        onClick={() =>
          void run(async () => {
            download(
              selectBackupWorkspaces(
                await createBackup(accountRepository),
                exportIds,
              ),
            );
            setMessage(`已发起 ${exportIds.length} 个工作区的备份下载。`);
          })
        }
      >
        <Download size={15} />
        导出所选工作区
      </Button>
      <Button
        disabled={busy || !state || !saved}
        onClick={() =>
          void run(async () => {
            download(await createBackup(accountRepository));
            setMessage('已发起完整账号备份下载。');
          })
        }
      >
        导出完整账号备份（含偏好与全部收件）
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
            setImportIds([]);
            setConfirmed(false);
            setReplace(false);
            if (!file) return;
            void run(async () => {
              if (file.size > BACKUP_LIMIT)
                throw new Error('备份超过 100 MB。');
              const parsed = parseBackup(await file.text());
              setBackup(parsed);
              setImportIds(backupState(parsed).workspaces.map((w) => w.id));
            });
          }}
        />
      </label>
      {backup && imported && counts && (
        <div className="form-stack">
          <p className="callout">
            备份时间：{new Date(backup.createdAt).toLocaleString()}
            <br />
            文件含 {imported.workspaces.length} 个工作区；已选{' '}
            {counts.workspaces} 个 · {counts.turns} 轮原文 · {counts.notes} 条
            Note · {counts.uploads} 份关联收件
          </p>
          <WorkspaceSelection
            label="选择导入的工作区"
            workspaces={imported.workspaces}
            selected={importIds}
            disabled={busy || replace}
            onChange={(ids) => {
              setImportIds(ids);
              setConfirmed(false);
            }}
          />
          <p className="inline-note">
            默认追加为独立工作区，现有内容、偏好、连接和后台任务保留；同名工作区也不会覆盖。导入的工作区需重新配置模型与
            MCP，摘要自动运行保持关闭。未选择的工作区和账号级数据不会导入。
          </p>
          <label className="checks">
            <input
              type="checkbox"
              checked={replace}
              disabled={busy}
              onChange={(e) => {
                setReplace(e.target.checked);
                setConfirmed(false);
              }}
            />
            <span>
              高级：完整覆盖恢复（使用整个文件，覆盖当前账号全部数据）
            </span>
          </label>
          {replace && (
            <p className="inline-note">
              完整恢复会忽略上面的工作区选择，覆盖工作区、草稿和偏好。覆盖前下载当前账号备份；现有任务、MCP
              连接和投递连接会取消，其他设备需要刷新。
              {!state && '当前数据读取失败，无法生成覆盖前备份。'}
            </p>
          )}
          <label className="checks">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              {replace
                ? '我确认用整个备份覆盖当前账号数据'
                : `确认追加导入所选 ${selected.length} 个工作区`}
            </span>
          </label>
          <Button
            primary
            disabled={
              busy ||
              !confirmed ||
              (!replace && (!selected.length || !state)) ||
              (Boolean(state) && !saved)
            }
            onClick={() =>
              void run(async () => {
                if (replace) {
                  if (state)
                    download(
                      await createBackup(accountRepository),
                      'ContextHub恢复前备份',
                    );
                  await taskRequest('session', {});
                  await taskRequest('cancel-all', {});
                  await mcpRequest('reset', {});
                  await restoreBackup(accountRepository, backup);
                } else
                  await importBackupWorkspaces(
                    accountRepository,
                    backup,
                    importIds,
                  );
                window.location.reload();
              })
            }
          >
            {replace ? '确认覆盖并恢复整个备份' : '导入所选工作区'}
          </Button>
        </div>
      )}
    </section>
  );
}
