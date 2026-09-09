'use client';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Plus } from 'lucide-react';
import {
  memoryText,
  memoryBlockLabel,
  uid,
  type Block,
  type Workspace,
} from '@/lib/domain';
import { useBlockReorder } from './use-block-reorder';
import { MemoryBlockCard } from './memory-block-card';
import { MemoryBlockEditor } from './memory-block-editor';
export function MemoryComposer({
  w,
  onChange,
}: {
  w: Workspace;
  onChange: (blocks: Block[]) => void;
}) {
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
            className="memory-drag-ghost"
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
