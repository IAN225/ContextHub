'use client';
import {
  attachmentLabels,
  attachmentStatus,
  fingerprintAttachment,
} from '@/lib/attachments/content';
import type { StorageEntry } from '@/lib/storage/account-repository';
import { usePersistent } from '@/lib/storage/use-persistent';
import { Check, ImagePlus, Paperclip, X } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import { DraftBoundary } from '../../components/shared/persistence-status.tsx';
import { Picker } from '../../components/shared/picker.tsx';
import { TextEditor } from '../../components/shared/text-editor.tsx';
import { uid } from '../../lib/core/identity.ts';
import {
  type Attachment,
  type Message,
  type Turn,
  type Workspace,
} from '../../lib/core/model.ts';

type TurnDraft = {
  messages: Message[];
  attachments: Attachment[];
  source: string;
};

export function TurnEditor({
  w,
  turn,
  afterId,
  onSave,
  onClose,
}: {
  w: Workspace;
  turn?: Turn;
  afterId: string | null;
  onSave: (turn: Turn, draft: StorageEntry) => Promise<boolean>;
  onClose: () => void;
}) {
  const initial: TurnDraft = {
    messages: turn?.messages ?? [
      { role: 'user', content: '' },
      { role: 'assistant', content: '' },
    ],
    attachments: turn?.attachments ?? [],
    source: turn?.source ?? w.platform,
  };
  const [draft, setDraft, save] = usePersistent(
    `turn-draft-${w.id}-${turn?.id ?? afterId ?? 'start'}`,
    initial,
  );
  const [error, setError] = useState(''),
    [reading, setReading] = useState(false);
  async function files(items: File[]) {
    setReading(true);
    setError('');
    try {
      const result: Attachment[] = [];
      for (const f of items) {
        if (f.size > 5 * 1024 * 1024) throw new Error('单个附件上限为 5 MB。');
        const url = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () =>
            typeof r.result === 'string'
              ? resolve(r.result)
              : reject(new Error('附件读取失败'));
          r.onerror = () => reject(new Error('附件读取失败'));
          r.readAsDataURL(f);
        });
        result.push(
          await fingerprintAttachment({
            id: uid(),
            name: f.name,
            type: f.type,
            url,
          }),
        );
      }
      setDraft((d) => ({ ...d, attachments: [...d.attachments, ...result] }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }
  const position = afterId ? w.turns.findIndex((t) => t.id === afterId) + 1 : 0;
  return (
    <Modal
      title={turn ? '编辑完整轮次' : '留下一段完整的对话'}
      description={
        turn
          ? '编辑当前轮次。'
          : `插入位置：${position === 0 ? '原文链开头' : `第 ${position} 轮之后`}。输入与后续模型、工具消息作为一个整体保存。`
      }
      onClose={() => {
        if (!save.busy) onClose();
      }}
    >
      <DraftBoundary state={save}>
        {!save.ready ? (
          <div>
            <p role={save.error ? 'alert' : undefined}>
              {save.error || '恢复草稿中…'}
            </p>
            {save.error && (
              <Button
                onClick={() => {
                  void save.retry();
                }}
              >
                重试读取
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="form-grid">
              <label className="field">
                来源平台
                <Picker
                  label="来源平台"
                  value={draft.source}
                  onChange={(source) => setDraft({ ...draft, source })}
                  options={[
                    ...new Set([
                      'ChatGPT',
                      'Claude',
                      'Chatbox',
                      '手动导入',
                      draft.source,
                    ]),
                  ].map((v) => ({ value: v, label: v }))}
                />
              </label>
            </div>
            <div className="form-stack">
              {draft.messages.map((m, i) => (
                <TextEditor
                  key={i}
                  label={
                    m.role === 'user'
                      ? 'YOU · 用户原始输入'
                      : m.role === 'assistant'
                        ? 'ASSISTANT · 模型原始输出'
                        : `${m.role.toUpperCase()} · ${m.name ?? '工具消息'}`
                  }
                  value={m.content}
                  onChange={(content) =>
                    setDraft({
                      ...draft,
                      messages: draft.messages.map((a, j) =>
                        j === i ? { ...a, content } : a,
                      ),
                    })
                  }
                  onFiles={files}
                />
              ))}
            </div>
            <div className="attachment-strip">
              {draft.attachments.map((a) => (
                <div key={a.id}>
                  {a.type.startsWith('image/') && a.url.startsWith('data:') ? (
                    <Image
                      unoptimized
                      src={a.url}
                      alt={a.name}
                      width={38}
                      height={38}
                    />
                  ) : (
                    <Paperclip size={18} />
                  )}
                  <span>
                    {a.name} · {attachmentLabels[attachmentStatus(a)]}
                  </span>
                  <button
                    aria-label={`移除附件 ${a.name}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        attachments: draft.attachments.filter(
                          (x) => x.id !== a.id,
                        ),
                      })
                    }
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <p className="inline-note">
              <ImagePlus size={13} /> 可粘贴图片，或添加附件。
            </p>
            {(error || save.error) && (
              <p role="alert" className="error-text">
                {error || save.error}
              </p>
            )}
            <div className="form-actions">
              <span className="save-caption">
                {reading
                  ? '正在保存附件…'
                  : save.saved
                    ? '✓ 草稿已保存'
                    : '正在保存草稿…'}
              </span>
              <Button disabled={save.busy} onClick={onClose}>
                关闭并保留草稿
              </Button>
              <Button
                primary
                disabled={
                  reading ||
                  !save.ready ||
                  (!draft.messages[0]?.content.trim() &&
                    !draft.attachments.length)
                }
                onClick={async () => {
                  const result: Turn = {
                    ...(turn ?? { id: uid(), status: 'normal', time: null }),
                    source: draft.source,
                    messages: draft.messages,
                    attachments: draft.attachments,
                  };
                  const cleared: TurnDraft = {
                    messages: [
                      { role: 'user', content: '' },
                      { role: 'assistant', content: '' },
                    ],
                    attachments: [],
                    source: w.platform,
                  };
                  setReading(true);
                  await save.commitWith(turn ? draft : cleared, (entry) =>
                    onSave(result, entry),
                  );
                  setReading(false);
                }}
              >
                <Check size={15} />
                {turn ? '保存修改' : '保存完整轮次'}
              </Button>
            </div>
          </>
        )}
      </DraftBoundary>
    </Modal>
  );
}
