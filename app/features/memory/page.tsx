'use client';
import { ArrowUpRight, RotateCcw, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { CopyButton } from '../../components/shared/copy-button.tsx';
import { Markdown } from '../../components/shared/markdown.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import { PageTitle } from '../../components/shared/page-title.tsx';
import { uid } from '../../lib/core/identity.ts';
import { type Workspace } from '../../lib/core/model.ts';
import { memoryNotes, memoryText } from '../../lib/memory/compose.ts';
import { type SendWorkspaceCommand } from '../../lib/state/contracts.ts';
import { summaryWorkspace } from '../../lib/summary/engines.ts';
import { MemoryComposer } from './composer.tsx';
export function MemoryPage({
  w,
  onCommand,
}: {
  w: Workspace;
  onCommand: SendWorkspaceCommand;
}) {
  const [noteId, setNoteId] = useState<string | null>(null);
  const engine = w.memoryEngine ?? 'custom';
  const scoped = summaryWorkspace(w, engine);
  const text = memoryText(w);
  const selectedIds = new Set(
    w.blocks
      .filter((b) => b.type === 'stars')
      .flatMap((b) => memoryNotes(w, b).map((n) => n.id)),
  );
  const notes = w.notes.filter((n) => selectedIds.has(n.id));
  const note = notes.find((n) => n.id === noteId);
  return (
    <>
      <div className="section-heading compact">
        <PageTitle>记忆包</PageTitle>
        <Button
          onClick={() =>
            onCommand({
              type: 'memory/set',
              blocks: [
                { id: uid(), type: 'summary' },
                { id: uid(), type: 'recent' },
                { id: uid(), type: 'stars' },
              ],
            })
          }
        >
          <RotateCcw size={14} />
          恢复默认
        </Button>
      </div>
      <div className="split-view memory-layout memory-layout-editable">
        <section aria-label="记忆包编排" className="memory-composer-pane">
          <MemoryComposer
            w={scoped}
            onEngineChange={(value) =>
              onCommand({ type: 'memory/engine', value })
            }
            onChange={(blocks) => onCommand({ type: 'memory/set', blocks })}
          />
          <p className="field-help memory-composer-help">
            拖动把手排序 · 点击组件编辑 · 修改自动保存
          </p>
        </section>
        <section className="memory-preview-pane surface">
          <div className="memory-preview-header">
            <h2>实时预览</h2>
            <small>{text.length.toLocaleString()} 字符</small>
            <CopyButton text={text} iconOnly label="复制记忆包" />
          </div>
          <div className="memory-preview-scroll">
            <pre>{text}</pre>
          </div>
        </section>
      </div>
      {notes.length > 0 && (
        <section className="memory-notes">
          <div className="surface-head">
            <h2>按 id 读取 Note</h2>
            <small>{notes.length} 条</small>
          </div>
          {notes.map((n) => (
            <button key={n.id} onClick={() => setNoteId(n.id)}>
              <StickyNote size={14} />
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
