'use client';
import { useState } from 'react';
import { Inbox, Trash2, FileText } from 'lucide-react';
import { Button, Modal, Empty, formatDate } from './shared';
import { TextEditor } from './editors';
import { RestoreDialog } from './summary-restore-dialog';
import { UploadTurnPreview } from './upload-turn-preview';
import { UploadArchiveActions } from './upload-archive-actions';
import { now, type Workspace, type Upload, type Summary } from '@/lib/domain';
export type UploadReviewProps = {
  uploads: Upload[];
  workspaces: Workspace[];
  currentId: string;
  onUpdate: (u: Upload) => void;
  onRemove: (id: string) => void;
  onImport: (u: Upload, target: string) => Promise<boolean>;
  onSummary: (
    u: Upload,
    w: Workspace,
    mode: 'keep' | 'rewind',
  ) => Promise<boolean>;
};

export function UploadReview({
  uploads,
  workspaces,
  currentId,
  onUpdate,
  onRemove,
  onImport,
  onSummary,
  delivery = false,
}: UploadReviewProps & { delivery?: boolean }) {
  const [selected, setSelected] = useState(uploads[0]?.id),
    [target, setTarget] = useState(currentId),
    [checked, setChecked] = useState<string[]>([]),
    [restore, setRestore] = useState(false),
    [remove, setRemove] = useState(false);
  const u = uploads.find((x) => x.id === selected) ?? uploads[0];
  const w = workspaces.find(
    (w) => w.id === (u?.kind === 'summary' ? u.workspaceId : target),
  );
  function edit(p: Partial<Upload>) {
    if (u) onUpdate({ ...u, ...p });
  }
  const candidate: Summary = {
    id: `candidate-${u?.id}`,
    title: u?.title ?? '',
    text: u?.summaryText ?? '',
    covered: u?.covered ?? [],
    createdAt: now(),
  };
  return (
    <>
      {uploads.length ? (
        <div className="inbox-layout">
          <aside className="inbox-list">
            <div className="surface-head">
              <h2>{delivery ? '待归档上下文' : '待确认内容'}</h2>
              <span className="pill">{uploads.length} 份</span>
            </div>
            {uploads.map((x) => (
              <button
                className={u?.id === x.id ? 'selected' : ''}
                key={x.id}
                onClick={() => {
                  setSelected(x.id);
                  setChecked([]);
                }}
              >
                <span className="inbox-item-icon">
                  {x.kind === 'summary' ? (
                    <FileText size={17} />
                  ) : (
                    <Inbox size={17} />
                  )}
                </span>
                <div>
                  <h3>{x.title}</h3>
                  <p>
                    {x.kind === 'summary'
                      ? '工作台候选摘要'
                      : `${x.turns.length} 个完整轮次`}
                  </p>
                  <small>{formatDate(x.createdAt)}</small>
                </div>
              </button>
            ))}
          </aside>
          {u && (
            <article className="inbox-paper">
              <div className="inbox-paper-top">
                <div>
                  <span className="eyebrow">
                    {u.kind === 'summary'
                      ? 'SUMMARY DRAFT'
                      : 'CONVERSATION DELIVERY'}
                  </span>
                  <input
                    aria-label="上传内容标题"
                    className="note-title-input"
                    value={u.title}
                    onChange={(e) => edit({ title: e.target.value })}
                  />
                  <p>
                    {u.source} · {formatDate(u.createdAt)}
                  </p>
                </div>
                <button
                  aria-label="删除这份待确认内容"
                  className="icon-button"
                  onClick={() => setRemove(true)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {u.warning && <p className="callout warning">{u.warning}</p>}
              {u.kind === 'summary' ? (
                <TextEditor
                  label="候选摘要 · 可直接修改"
                  value={u.summaryText ?? ''}
                  onChange={(summaryText) => edit({ summaryText })}
                  minHeight={320}
                />
              ) : (
                <UploadTurnPreview
                  turns={u.turns}
                  checked={checked}
                  onCheckedChange={setChecked}
                  onRemoveChecked={() => {
                    edit({
                      turns: u.turns.filter((t) => !checked.includes(t.id)),
                    });
                    setChecked([]);
                  }}
                />
              )}
              <UploadArchiveActions
                u={u}
                w={w}
                workspaces={workspaces}
                target={target}
                onTargetChange={setTarget}
                onRestore={() => setRestore(true)}
                onImport={onImport}
              />
            </article>
          )}
        </div>
      ) : (
        <Empty
          title={delivery ? '暂无待归档上下文' : '没有待确认内容'}
          detail={
            delivery
              ? '通过「收录对话 → 发布对话 API」查看接入方式。在第三方客户端配置后，发送一条消息即可投递上下文。'
              : '已有内容已处理，可以关闭窗口继续。'
          }
        />
      )}
      {restore && u && w && (
        <RestoreDialog
          w={w}
          summary={candidate}
          onClose={() => setRestore(false)}
          onApply={async (mode) => {
            if (await onSummary(u, w, mode)) setRestore(false);
          }}
        />
      )}
      {remove && u && (
        <Modal
          title="删除这份未归档内容？"
          description="只影响当前收件，不影响已经存在于手账中的原文。"
          onClose={() => setRemove(false)}
        >
          <p className="callout warning">
            「{u.title}
            」将永久删除。这份尚未归档的内容无法从原文回收站恢复。
          </p>
          <div className="form-actions">
            <Button onClick={() => setRemove(false)}>保留</Button>
            <Button
              onClick={() => {
                onRemove(u.id);
                setRemove(false);
                setChecked([]);
              }}
            >
              删除这份收件
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
