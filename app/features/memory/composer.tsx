'use client';
import { GripVertical, Plus } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useBlockReorder } from '../../components/shared/use-block-reorder.ts';
import { useWorkspaceThemeClass } from '../../components/theme/workspace-theme.tsx';
import { uid } from '../../lib/core/identity.ts';
import { type Block, type Workspace } from '../../lib/core/model.ts';
import { memoryBlockLabel, memoryText } from '../../lib/memory/compose.ts';
import { engineLabels, type SummaryEngine } from '../../lib/summary/engines.ts';
import { MemoryBlockCard } from './block-card.tsx';
import { MemoryBlockEditor } from './block-editor.tsx';
export function MemoryComposer({
  w,
  onChange,
  onEngineChange,
}: {
  w: Workspace;
  onEngineChange: (engine: SummaryEngine) => void;
  onChange: (blocks: Block[]) => void;
}) {
  const themeClass = useWorkspaceThemeClass();
  const [editing, setEditing] = useState<string | null>(null);
  const { list, drag, dragPoint, move, startDrag } = useBlockReorder(
    w.blocks,
    onChange,
  );
  const block = w.blocks.find((b) => b.id === editing);
  const dragged = w.blocks.find((b) => b.id === drag?.id);
  function update(patch: Partial<Block>) {
    onChange(w.blocks.map((b) => (b.id === editing ? { ...b, ...patch } : b)));
  }
  return (
    <>
      <div className="memory-composer" ref={list}>
        {w.blocks.map((b, i) => (
          <MemoryBlockCard
            key={b.id}
            block={b}
            sourceLabel={
              b.type === 'summary'
                ? engineLabels[w.summaryEngine ?? 'custom']
                : undefined
            }
            preview={memoryText(w, [b])
              .replace(/^\[[^\]]*\]\n/, '')
              .slice(0, 100)}
            first={i === 0}
            last={i === w.blocks.length - 1}
            dragging={drag?.id === b.id}
            onEdit={() => setEditing(b.id)}
            onMove={(direction) => move(b.id, i + direction)}
            onDragStart={(event) => startDrag(b.id, event)}
          />
        ))}
      </div>
      <div className="composer-add">
        {(['text', 'summary', 'recent', 'stars'] as const).map((type) => (
          <button
            key={type}
            onClick={() =>
              onChange([
                ...w.blocks,
                { id: uid(), type, ...(type === 'text' ? { text: '' } : {}) },
              ])
            }
          >
            <Plus size={13} />
            {memoryBlockLabel({ id: '', type })}
          </button>
        ))}
      </div>
      {drag &&
        dragged &&
        createPortal(
          <div
            className={'memory-drag-ghost ' + themeClass}
            style={{
              left: dragPoint.x - drag.offsetX,
              top: dragPoint.y - drag.offsetY,
              width: drag.width,
            }}
          >
            <GripVertical size={18} />
            {memoryBlockLabel(dragged)}
          </div>,
          document.body,
        )}
      {block && (
        <MemoryBlockEditor
          key={block.id}
          w={w}
          block={block}
          onEngineChange={onEngineChange}
          onUpdate={update}
          onClose={() => setEditing(null)}
          onRemove={() => {
            onChange(w.blocks.filter((b) => b.id !== block.id));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
