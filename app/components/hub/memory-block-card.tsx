'use client';
import type { PointerEvent } from 'react';
import { GripVertical, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import { memoryBlockLabel, type Block } from '@/lib/domain';
export function MemoryBlockCard({
  block: b,
  preview,
  first,
  last,
  dragging,
  onEdit,
  onMove,
  onDragStart,
}: {
  block: Block;
  preview: string;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onEdit: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <article
      data-block-id={b.id}
      className={`memory-block ${b.type}${dragging ? ' is-placeholder' : ''}`}
    >
      <div className="memory-block-row">
        <button
          className="memory-drag-handle"
          aria-label={`拖动${memoryBlockLabel(b)}`}
          onPointerDown={onDragStart}
        >
          <GripVertical size={18} />
        </button>
        <button
          className="memory-block-open"
          onClick={onEdit}
          aria-label={`编辑${memoryBlockLabel(b)}`}
        >
          <span className="memory-block-heading">
            <strong title={memoryBlockLabel(b)}>{memoryBlockLabel(b)}</strong>
            <small>
              {b.custom || b.type === 'text' ? '自定义' : '动态引用'}
            </small>
          </span>
          <span className="memory-block-preview">
            {preview || '点击编写内容'}
            <span className="memory-block-edit-hint">
              <Pencil size={12} />
              编辑
            </span>
          </span>
        </button>
        <button
          className="icon-button"
          aria-label={`上移${memoryBlockLabel(b)}`}
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ChevronUp size={17} />
        </button>
        <button
          className="icon-button"
          aria-label={`下移${memoryBlockLabel(b)}`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ChevronDown size={17} />
        </button>
      </div>
    </article>
  );
}
