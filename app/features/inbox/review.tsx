'use client';
import { FileText, Inbox, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { Empty } from '../../components/shared/empty.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import { TextEditor } from '../../components/shared/text-editor.tsx';
import { now } from '../../lib/core/identity.ts';
import {
  type Summary,
  type Upload,
  type Workspace,
} from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import { deliveryTriggerTurn } from '../../lib/imports/delivery-review.ts';
import { RestoreDialog } from '../summary/index.ts';
import { UploadArchiveActions } from './archive-actions.tsx';
import { UploadTurnPreview } from './turn-preview.tsx';
export type UploadReviewProps = {
  uploads: Upload[];
  workspaces: Workspace[];
  currentId: string;
  onUpdate: (u: Upload) => void;
  onRemove: (id: string) => void;
  onImport: (
    u: Upload,
    target: string,
    excludedTriggerId?: string,
  ) => Promise<boolean>;
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
    [target, setTarget] = useState(
      workspaces.some((w) => w.id === currentId) ? currentId : 'new',
    ),
    [checked, setChecked] = useState<string[]>([]),
    [restore, setRestore] = useState(false),
    [remove, setRemove] = useState(false);
  const [includedTriggers, setIncludedTriggers] = useState<string[]>([]);
  const u = uploads.find((x) => x.id === selected) ?? uploads[0];
  const trigger = u && deliveryTriggerTurn(u);
  const triggerKey = `${u?.id}:${trigger?.id}`;
  const includeTrigger = includedTriggers.includes(triggerKey);
  const preview =
    u && trigger && !includeTrigger
      ? { ...u, turns: u.turns.filter((turn) => turn.id !== trigger.id) }
      : u;
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
          {u && preview && (
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
              <section
                className="inbox-paper-body"
                key={u.id}
                aria-label="收件内容"
              >
                {u.warning && <p className="callout warning">{u.warning}</p>}
                {trigger && (
                  <div className="delivery-trigger-option">
                    <label>
                      <input
                        type="checkbox"
                        checked={includeTrigger}
                        onChange={(event) => {
                          setIncludedTriggers((values) =>
                            event.target.checked
                              ? [...values, triggerKey]
                              : values.filter((value) => value !== triggerKey),
                          );
                          setChecked((values) =>
                            values.filter((id) => id !== trigger.id),
                          );
                        }}
                      />
                      保留最后一条用户消息
                    </label>
                    <p>
                      末尾尚无回复的消息通常用于触发投递，默认不归档；如果它属于原对话，可以勾选保留。
                    </p>
                    <details>
                      <summary>查看这条消息</summary>
                      <p>{trigger.messages[0].content}</p>
                    </details>
                  </div>
                )}
                {preview &&
                  !preview.turns.length &&
                  u.kind === 'conversation' && (
                    <p className="inline-note">
                      没有可归档的历史轮次。可保留上方消息，或删除这份测试收件。
                    </p>
                  )}
                {u.kind === 'summary' ? (
                  <TextEditor
                    label="候选摘要 · 可直接修改"
                    value={u.summaryText ?? ''}
                    onChange={(summaryText) => edit({ summaryText })}
                    minHeight={320}
                  />
                ) : (
                  <UploadTurnPreview
                    turns={preview.turns}
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
              </section>
              <UploadArchiveActions
                u={preview}
                w={w}
                workspaces={workspaces}
                target={target}
                onTargetChange={setTarget}
                onRestore={() => setRestore(true)}
                onImport={(upload, destination) =>
                  onImport(
                    upload,
                    destination,
                    trigger && !includeTrigger ? trigger.id : undefined,
                  )
                }
              />
            </article>
          )}
        </div>
      ) : (
        <Empty
          title={delivery ? '暂无待归档上下文' : '没有待确认内容'}
          detail={
            delivery
              ? '通过「收录对话」导入分享链接，或配置客户端投递。收到的对话会保留在这里，直到归档或删除。'
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
          description="编辑当前收件。"
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
