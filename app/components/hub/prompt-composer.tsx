'use client';
import { createPortal } from 'react-dom';
import {
  GripVertical,
  Plus,
  ChevronUp,
  ChevronDown,
  X,
  FileText,
  Layers,
  MessageSquare,
  Star,
} from 'lucide-react';
import { uid, type Block } from '@/lib/domain';
import { useBlockReorder } from './use-block-reorder';
export const blockLabels = {
  text: '自定义文本',
  summary: '当前活跃摘要',
  recent: '原文滑动窗口',
  stars: '标星 Note id 列表',
};
const blockIcons = {
  text: FileText,
  summary: Layers,
  recent: MessageSquare,
  stars: Star,
};
export function Composer({
  blocks,
  onChange,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
}) {
  const { list, drag, dragPoint, move, startDrag } = useBlockReorder(
    blocks,
    onChange,
  );
  const dragged = blocks.find((b) => b.id === drag?.id);
  return (
    <div className="composer">
      <div className="composer-guide">
        按顺序拼装文本 <span>拖动排序 · 长文动态引用</span>
      </div>
      <div className="compose-block-list" ref={list}>
        {blocks.map((b, i) => {
          const Icon = blockIcons[b.type];
          return (
            <div
              key={b.id}
              data-block-id={b.id}
              className={`compose-block ${b.type}${drag?.id === b.id ? ' is-placeholder' : ''}`}
            >
              <div className="block-head">
                <button
                  type="button"
                  className="compose-drag-handle"
                  aria-label={`拖动${blockLabels[b.type]}`}
                  onPointerDown={(event) => startDrag(b.id, event)}
                >
                  <GripVertical size={16} />
                </button>
                <Icon size={16} />
                <span>{blockLabels[b.type]}</span>
                <span className="block-spacer" />
                {b.type !== 'text' && <small>动态引用</small>}
                <button
                  aria-label="上移"
                  className="icon-button tiny"
                  onClick={() => move(b.id, i - 1)}
                  disabled={i === 0}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  aria-label="下移"
                  className="icon-button tiny"
                  onClick={() => move(b.id, i + 1)}
                  disabled={i === blocks.length - 1}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  aria-label="移除块"
                  className="icon-button tiny"
                  onClick={() => onChange(blocks.filter((x) => x.id !== b.id))}
                >
                  <X size={14} />
                </button>
              </div>
              {b.type === 'text' ? (
                <textarea
                  aria-label="自定义文本"
                  value={b.text ?? ''}
                  onChange={(e) =>
                    onChange(
                      blocks.map((x) =>
                        x.id === b.id ? { ...x, text: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="输入你想对模型说的话…"
                />
              ) : (
                <p>调用时自动读取最新内容，保持完整轮次。</p>
              )}
            </div>
          );
        })}
      </div>
      {drag &&
        dragged &&
        createPortal(
          <div
            className="compose-drag-ghost"
            style={{
              left: dragPoint.x - drag.offsetX,
              top: dragPoint.y - drag.offsetY,
              width: drag.width,
            }}
          >
            <GripVertical size={18} />
            {blockLabels[dragged.type]}
          </div>,
          document.body,
        )}
      <div className="composer-add">
        {Object.entries(blockLabels).map(([k, l]) => (
          <button
            key={k}
            onClick={() =>
              onChange([
                ...blocks,
                {
                  id: uid(),
                  type: k as Block['type'],
                  ...(k === 'text' ? { text: '' } : {}),
                },
              ])
            }
          >
            <Plus size={13} />
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
