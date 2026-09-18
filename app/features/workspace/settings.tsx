'use client';
import { Check, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import { ModelAvatar } from '../../components/shared/model-avatar.tsx';
import { PageTitle } from '../../components/shared/page-title.tsx';
import { type Workspace } from '../../lib/core/model.ts';
import type { CommitWorkspaceCommand } from '../../lib/use-hub.ts';
import {
  modelAvatars,
  workspaceTones,
  type WorkspaceAppearance,
} from '../../lib/workspace-appearance.ts';
export function WorkspaceSettings({
  w,
  onCommit,
  onDelete,
  ready,
}: {
  w: Workspace;
  onCommit: CommitWorkspaceCommand;
  onDelete: () => Promise<boolean>;
  ready: boolean;
}) {
  const [name, setName] = useState(w.name);
  const [appearance, setAppearance] = useState<WorkspaceAppearance>(
    w.appearance ?? {},
  );
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  async function save() {
    setBusy(true);
    setMessage('');
    try {
      if (await onCommit({ type: 'workspace/settings', name, appearance }))
        setMessage('已保存');
      else setMessage('保存失败，请重试。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setMessage('');
    try {
      if (!(await onDelete())) setMessage('删除未完成，请重试。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <PageTitle>工作区设置</PageTitle>
      </div>
      <section className="workspace-preferences surface">
        <label className="field">
          工作区名称
          <input
            value={name}
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>主题色</legend>
          <div className="appearance-options">
            {Object.entries(workspaceTones).map(([tone, label]) => (
              <button
                type="button"
                key={tone}
                className={'tone-option tone-' + tone}
                aria-pressed={(appearance.tone ?? 'sage') === tone}
                onClick={() =>
                  setAppearance({
                    ...appearance,
                    tone: tone as WorkspaceAppearance['tone'],
                  })
                }
              >
                <span className="tone-swatch" />
                {label}
                {(appearance.tone ?? 'sage') === tone && <Check size={14} />}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>模型头像</legend>
          <div className="appearance-options">
            {Object.entries(modelAvatars).map(([avatar, label]) => (
              <button
                type="button"
                key={avatar}
                aria-pressed={(appearance.avatar ?? 'sparkles') === avatar}
                onClick={() =>
                  setAppearance({
                    ...appearance,
                    avatar: avatar as WorkspaceAppearance['avatar'],
                  })
                }
              >
                <ModelAvatar value={avatar as WorkspaceAppearance['avatar']} />
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="action-row">
          <Button
            primary
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            保存
          </Button>
          <output>{message}</output>
        </div>
      </section>
      <section className="workspace-delete-section">
        <Button
          className="danger"
          disabled={busy || !ready}
          onClick={() => setConfirm(true)}
        >
          <Trash2 size={15} />
          删除工作区
        </Button>
      </section>
      {confirm && (
        <Modal
          title="删除工作区"
          description={
            '将删除“' +
            w.name +
            '”的原文、摘要、Note 和连接授权。此操作无法撤销。'
          }
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <div className="action-row">
            <Button disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </Button>
            <Button
              disabled={busy}
              className="danger"
              onClick={() => void remove()}
            >
              {busy ? '正在删除…' : '确认删除'}
            </Button>
          </div>
          {message && <p role="alert">{message}</p>}
        </Modal>
      )}
    </>
  );
}
