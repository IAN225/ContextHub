'use client';
import { useState } from 'react';
import { Eye, PackageOpen, ArrowUpRight, RotateCcw, Star } from 'lucide-react';
import {
  Button,
  PageTitle,
  Composer,
  Markdown,
  CopyButton,
  Modal,
} from './shared';
import { coverage, memoryText, uid, type Workspace } from '@/lib/domain';
export function MemoryPage({
  w,
  onChange,
}: {
  w: Workspace;
  onChange: (w: Workspace) => void;
}) {
  const [preview, setPreview] = useState(false),
    [noteId, setNoteId] = useState<string | null>(null);
  const c = coverage(w),
    text = memoryText(w),
    starred = w.notes.filter((n) => n.star && n.status === 'normal'),
    note = starred.find((n) => n.id === noteId);
  return (
    <>
      <div className="section-heading compact">
        <div>
          <div className="eyebrow">A BRIDGE TO YOUR NEXT CONVERSATION</div>
          <PageTitle mobile="记忆包">让下一段对话，接着这里。</PageTitle>
          <p>你决定模型在重新认识你时，先读到什么。</p>
        </div>
        <Button primary onClick={() => setPreview(true)}>
          <Eye size={15} />
          预览记忆包
        </Button>
      </div>
      <div className="memory-callout">
        <PackageOpen size={25} />
        <div>
          <h2>记忆注入 · memory_bootstrap</h2>
          <p>
            推荐在新窗口或严重遗忘上下文时调用。正常交流中，不需要频繁重新注入。
          </p>
        </div>
        <span className="pill">按需读取</span>
      </div>
      <div className="split-view memory-layout">
        <section className="surface">
          <div className="surface-head">
            <h2>记忆包编排</h2>
            <button
              className="text-button"
              onClick={() =>
                onChange({
                  ...w,
                  blocks: [
                    { id: uid(), type: 'summary' },
                    { id: uid(), type: 'recent' },
                    { id: uid(), type: 'stars' },
                  ],
                })
              }
            >
              <RotateCcw size={13} />
              恢复默认
            </button>
          </div>
          <Composer
            blocks={w.blocks}
            onChange={(blocks) => onChange({ ...w, blocks })}
          />
          <p className="inline-note">
            排序与编辑自动保存。动态块在每次调用时读取当前状态；默认只返回标星
            Note 的 id 与标题，正文需单独读取。
          </p>
        </section>
        <section className="memory-preview-pane surface">
          <div className="surface-head">
            <h2>此刻会带走的记忆</h2>
            <span className="pill">实时预览</span>
          </div>
          <div className="memory-counts">
            <div>
              <strong>{c.active?.covered.length ?? 0}</strong>
              <span>轮摘要覆盖</span>
            </div>
            <div>
              <strong>{c.recent.length}</strong>
              <span>轮近期原文</span>
            </div>
            <div>
              <strong>{starred.length}</strong>
              <span>条标星 Note</span>
            </div>
          </div>
          {c.gap.length > 0 && (
            <p className="callout warning">
              有 {c.gap.length} 轮原文处于缺口中，不会随默认记忆包返回。
            </p>
          )}
          <div className="memory-preview-scroll">
            <pre>{text}</pre>
          </div>
          <div className="memory-preview-bottom">
            <span>{text.length.toLocaleString()} 字符 · 不截断完整轮次</span>
            <CopyButton text={text} />
          </div>
        </section>
      </div>
      <section className="memory-notes">
        <div className="surface-head">
          <h2>模型可以继续按 id 读取</h2>
          <small>标星笔记优先展示 50 字预览</small>
        </div>
        {starred.map((n) => (
          <button key={n.id} onClick={() => setNoteId(n.id)}>
            <Star size={14} />
            <div>
              <strong>{n.title}</strong>
              <p>
                {n.body.slice(0, 50)}
                {n.body.length > 50 ? '…' : ''}
              </p>
            </div>
            <code>{n.id}</code>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </section>
      {preview && (
        <Modal
          title="新窗口将收到这份记忆"
          description="下方为编排后的完整内容。本地预览不调用外部模型。"
          onClose={() => setPreview(false)}
        >
          <div className="full-memory">
            <pre>{text}</pre>
          </div>
          <div className="form-actions">
            <CopyButton text={text} />
          </div>
        </Modal>
      )}
      {note && (
        <Modal
          title={note.title}
          description={`按 id 读取 · ${note.id}`}
          onClose={() => setNoteId(null)}
        >
          <Markdown text={note.body} />
        </Modal>
      )}
    </>
  );
}
