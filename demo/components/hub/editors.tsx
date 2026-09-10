'use client';
import Image from 'next/image';
import { useRef, useState, type ReactNode } from 'react';
import {
  Bold,
  List,
  ImagePlus,
  Paperclip,
  Check,
  Code2,
  Eye,
  Type,
  X,
  Plus,
} from 'lucide-react';
import { Button, Modal, Markdown, Picker } from './shared';
import { usePersistent } from '@/lib/store';
import type { StorageEntry } from '@/lib/repository';
import {
  fingerprintAttachment,
  attachmentStatus,
  attachmentLabels,
} from '@/lib/attachments';
import {
  uid,
  type Attachment,
  type Message,
  type Turn,
  type Workspace,
} from '@/lib/domain';

export function TextEditor({
  value,
  onChange,
  label,
  minHeight = 160,
  onFiles,
  labelAction,
}: {
  value: string;
  onChange: (s: string) => void;
  label: string;
  minHeight?: number;
  onFiles?: (files: File[]) => void;
  labelAction?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    [preview, setPreview] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  function wrap(before: string, after = '') {
    const e = ref.current;
    if (!e) return;
    const start = e.selectionStart,
      end = e.selectionEnd;
    onChange(
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
    requestAnimationFrame(() => {
      e.focus();
      e.setSelectionRange(start + before.length, end + before.length);
    });
  }
  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        {labelAction ? (
          <div className="editor-label">
            <span>{label}</span>
            {labelAction}
          </div>
        ) : (
          <span>{label}</span>
        )}
        <div>
          <button
            aria-label="加粗"
            title="加粗"
            disabled={preview}
            onClick={() => wrap('**', '**')}
          >
            <Bold size={14} />
          </button>
          <button
            aria-label="添加列表"
            disabled={preview}
            onClick={() => wrap('\n- ')}
          >
            <List size={15} />
          </button>
          <button
            aria-label="添加代码"
            disabled={preview}
            onClick={() => wrap('\n```\n', '\n```')}
          >
            <Code2 size={15} />
          </button>
          {onFiles && (
            <>
              <button
                aria-label="添加图片或附件"
                onClick={() => file.current?.click()}
              >
                <Paperclip size={15} />
              </button>
              <input
                hidden
                ref={file}
                type="file"
                multiple
                onChange={(e) => {
                  onFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button
            aria-label={preview ? '编辑文本' : '预览 Markdown'}
            className={preview ? 'mint' : ''}
            onClick={() => setPreview(!preview)}
          >
            {preview ? <Type size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="editor-preview" style={{ minHeight }}>
          <Markdown text={value || '尚无内容'} />
        </div>
      ) : (
        <textarea
          ref={ref}
          aria-label={label}
          style={{ minHeight }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length && onFiles) {
              e.preventDefault();
              onFiles(files);
            }
          }}
          placeholder="粘贴或写下原文…支持 Markdown、图片粘贴与附件"
        />
      )}
    </div>
  );
}
type TurnDraft = {
  messages: Message[];
  attachments: Attachment[];
  source: string;
  title: string;
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
    title: turn?.title ?? '',
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
          ? '保留每条消息的位置与工具调用结构。修改已有原文不会重写历史摘要。'
          : `插入位置：${position === 0 ? '原文链开头' : `第 ${position} 轮之后`}。输入与后续模型、工具消息作为一个整体保存。`
      }
      onClose={() => {
        if (!save.busy) onClose();
      }}
    >
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
              标题（可选）
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="留空时使用用户输入开头"
              />
            </label>
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
            <ImagePlus size={13} />{' '}
            可以直接粘贴图片，或使用编辑栏添加附件。新建轮次标记为「时间未知」。
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
                  ? '✓ 草稿已保存到此浏览器'
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
                  title:
                    draft.title.trim() ||
                    draft.messages[0].content.slice(0, 40) ||
                    '附件对话',
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
                  title: '',
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
    </Modal>
  );
}
export function NewWorkspace({
  onCreate,
  onClose,
}: {
  onCreate: (
    name: string,
    platform: string,
    draft: StorageEntry,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [d, setD, p] = usePersistent('new-workspace-draft', {
    name: '',
    platform: 'ChatGPT',
  });
  return (
    <Modal
      title="新建手账"
      description="每本手账独立保存原文、摘要、Note 和记忆包，连接授权也按手账管理。"
      onClose={() => {
        if (!p.busy) onClose();
      }}
    >
      <label className="field">
        手账名称
        <input
          value={d.name}
          onChange={(e) => setD({ ...d, name: e.target.value })}
          placeholder="给这段对话起个名字"
        />
      </label>
      <label className="field">
        来源平台
        <Picker
          value={d.platform}
          label="新手账平台"
          options={['ChatGPT', 'Claude', 'Chatbox', '其他'].map((v) => ({
            value: v,
            label: v,
          }))}
          onChange={(platform) => setD({ ...d, platform })}
        />
      </label>
      <p className="callout">
        第一次导入原文后，配置摘要模型，再由你手动开始首次压缩。
      </p>
      <div className="form-actions">
        <span className="save-caption">
          {p.error || (p.saved ? '✓ 草稿已保存' : '保存中…')}
          {p.error && (
            <button
              className="text-button"
              onClick={() => {
                void p.retry();
              }}
            >
              {p.ready ? '重试保存' : '重试读取'}
            </button>
          )}
        </span>
        <Button
          primary
          disabled={!d.name.trim() || !p.ready || p.busy}
          onClick={async () => {
            await p.commitWith({ name: '', platform: 'ChatGPT' }, (entry) =>
              onCreate(d.name.trim(), d.platform, entry),
            );
          }}
        >
          <Plus size={15} />
          创建手账
        </Button>
      </div>
    </Modal>
  );
}
