'use client';
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  GripVertical,
  ChevronUp,
  ChevronDown,
  Pencil,
  Plus,
  Minus,
  Trash2,
} from 'lucide-react';
import { Button, Modal } from './shared';
import {
  coverage,
  memoryText,
  memoryNotes,
  memoryBlockLabel,
  uid,
  type Block,
  type Workspace,
} from '@/lib/domain';

type Drag = {
  id: string;
  pointerId: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  width: number;
  original: string[];
};
export function MemoryComposer({
  w,
  onChange,
}: {
  w: Workspace;
  onChange: (blocks: Block[]) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const latest = useRef({ w, onChange });
  useLayoutEffect(() => {
    latest.current = { w, onChange };
  }, [w, onChange]);
  useLayoutEffect(() => {
    if (!list.current) return;
    for (const card of list.current.querySelectorAll<HTMLElement>(
      '[data-block-id]',
    )) {
      const before = positions.current.get(card.dataset.blockId!);
      const delta =
        before === undefined ? 0 : before - card.getBoundingClientRect().top;
      if (
        delta &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches
      )
        card.animate(
          [
            { transform: `translateY(${delta}px)` },
            { transform: 'translateY(0)' },
          ],
          { duration: 160, easing: 'ease-out' },
        );
    }
    positions.current.clear();
  }, [w.blocks]);
  function rememberPositions() {
    positions.current = new Map(
      Array.from(
        list.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [],
      ).map((e) => [e.dataset.blockId!, e.getBoundingClientRect().top]),
    );
  }
  function move(id: string, target: number) {
    const blocks = [...w.blocks],
      from = blocks.findIndex((b) => b.id === id);
    if (from < 0 || target < 0 || target >= blocks.length || from === target)
      return;
    rememberPositions();
    blocks.splice(target, 0, blocks.splice(from, 1)[0]);
    onChange(blocks);
  }
  useEffect(() => {
    if (!drag) return;
    let point = { x: drag.x, y: drag.y };
    let frame = 0;
    const reorder = () => {
      const { w: current, onChange: change } = latest.current;
      const cards = Array.from(
        list.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [],
      );
      const others = cards.filter((e) => e.dataset.blockId !== drag.id);
      const target = others.filter(
        (e) =>
          point.y >
          list.current!.getBoundingClientRect().top +
            e.offsetTop +
            e.offsetHeight / 2,
      ).length;
      const blocks = [...current.blocks],
        from = blocks.findIndex((b) => b.id === drag.id);
      if (from < 0 || from === target) return;
      positions.current = new Map(
        cards.map((e) => [e.dataset.blockId!, e.getBoundingClientRect().top]),
      );
      blocks.splice(target, 0, blocks.splice(from, 1)[0]);
      change(blocks);
    };
    const movePointer = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      point = { x: e.clientX, y: e.clientY };
      setDragPoint(point);
      reorder();
    };
    const finish = (e: PointerEvent) => {
      if (e.pointerId === drag.pointerId) setDrag(null);
    };
    const cancel = () => {
      const { w: current, onChange: change } = latest.current;
      change(
        [...current.blocks].sort(
          (a, b) => drag.original.indexOf(a.id) - drag.original.indexOf(b.id),
        ),
      );
      setDrag(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    const tick = () => {
      const main = list.current?.closest<HTMLElement>('.page-content');
      const internal =
        main &&
        main.scrollHeight > main.clientHeight &&
        getComputedStyle(main).overflowY === 'auto';
      const bounds = internal
        ? main.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const delta =
        point.y < bounds.top + 55 ? -10 : point.y > bounds.bottom - 55 ? 10 : 0;
      if (delta) {
        if (internal) main.scrollTop += delta;
        else window.scrollBy(0, delta);
        reorder();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener('pointermove', movePointer, { passive: false });
    window.addEventListener('pointerup', finish);
    const cancelPointer = (e: PointerEvent) => {
      if (e.pointerId === drag.pointerId) cancel();
    };
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('keydown', key);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('keydown', key);
    };
    // Coordinates live in the handlers; keep the drag session stable while cards reorder.
  }, [drag]);
  const block = w.blocks.find((b) => b.id === editing);
  const dragged = w.blocks.find((b) => b.id === drag?.id);
  function update(patch: Partial<Block>) {
    onChange(w.blocks.map((b) => (b.id === editing ? { ...b, ...patch } : b)));
  }
  return (
    <>
      <div className="memory-composer" ref={list}>
        {w.blocks.map((b, i) => (
          <article
            key={b.id}
            data-block-id={b.id}
            className={`memory-block ${b.type}${drag?.id === b.id ? ' is-placeholder' : ''}`}
          >
            <div className="memory-block-row">
              <button
                className="memory-drag-handle"
                aria-label={`拖动${memoryBlockLabel(b)}`}
                onPointerDown={(e) => {
                  if (e.button !== 0 || !e.isPrimary) return;
                  e.preventDefault();
                  const rect = e.currentTarget
                    .closest('article')!
                    .getBoundingClientRect();
                  setDragPoint({ x: e.clientX, y: e.clientY });
                  setDrag({
                    id: b.id,
                    pointerId: e.pointerId,
                    x: e.clientX,
                    y: e.clientY,
                    offsetX: e.clientX - rect.x,
                    offsetY: e.clientY - rect.y,
                    width: rect.width,
                    original: w.blocks.map((x) => x.id),
                  });
                }}
              >
                <GripVertical size={18} />
              </button>
              <button
                className="memory-block-open"
                onClick={() => {
                  setQuery('');
                  setEditing(b.id);
                }}
                aria-label={`编辑${memoryBlockLabel(b)}`}
              >
                <strong>{memoryBlockLabel(b)}</strong>
                <small>
                  {b.custom
                    ? '仅此记忆包'
                    : b.type === 'text'
                      ? '自由编写'
                      : '动态引用'}
                </small>
              </button>
              <button
                className="icon-button"
                aria-label={`上移${memoryBlockLabel(b)}`}
                disabled={i === 0}
                onClick={() => move(b.id, i - 1)}
              >
                <ChevronUp size={17} />
              </button>
              <button
                className="icon-button"
                aria-label={`下移${memoryBlockLabel(b)}`}
                disabled={i === w.blocks.length - 1}
                onClick={() => move(b.id, i + 1)}
              >
                <ChevronDown size={17} />
              </button>
            </div>
            <button
              className="memory-block-preview"
              onClick={() => {
                setQuery('');
                setEditing(b.id);
              }}
              aria-label={`打开${memoryBlockLabel(b)}`}
            >
              <span>
                {memoryText(w, [b])
                  .replace(/^\[[^\]]*\]\n/, '')
                  .slice(0, 100) || '点击编写内容'}
                <span className="memory-block-edit-hint">
                  <Pencil size={12} />
                  编辑
                </span>
              </span>
            </button>
          </article>
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
        <Modal
          title={memoryBlockLabel(block)}
          description="修改即时保存到此记忆包，不会改动源内容。删除后重新添加可恢复动态引用。"
          onClose={() => setEditing(null)}
        >
          <div className="memory-block-editor">
            {(block.type === 'summary' || block.type === 'text') && (
              <label>
                {block.type === 'summary' ? '摘要内容' : '文本内容'}
                <textarea
                  aria-label={
                    block.type === 'summary' ? '摘要内容' : '文本内容'
                  }
                  rows={12}
                  value={
                    block.type === 'summary' && !block.custom
                      ? (coverage(w).active?.text ?? '')
                      : (block.text ?? '')
                  }
                  onChange={(e) =>
                    update({
                      text: e.target.value,
                      ...(block.type === 'summary' ? { custom: true } : {}),
                    })
                  }
                />
              </label>
            )}
            {block.type === 'recent' && (
              <>
                <label>
                  完整原文轮数
                  <input
                    type="number"
                    min={0}
                    max={w.turns.length}
                    aria-label="自选窗口轮数"
                    value={block.custom ? (block.windowLength ?? 0) : w.retain}
                    onChange={(e) =>
                      update({
                        custom: true,
                        windowLength: Math.max(
                          0,
                          Math.min(
                            w.turns.length,
                            Math.floor(Number(e.target.value) || 0),
                          ),
                        ),
                      })
                    }
                  />
                </label>
                <p className="field-help">
                  沿用当前处理水位后的起点，只调整这份记忆包携带的完整轮数。
                </p>
                <pre className="memory-editor-preview">
                  {memoryText(w, [block])}
                </pre>
              </>
            )}
            {block.type === 'stars' && (
              <>
                <input
                  aria-label="查找 Note id 或标题"
                  placeholder="查找 Note id 或标题"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="memory-note-options">
                  {w.notes
                    .filter(
                      (n) =>
                        n.status === 'normal' &&
                        `${n.id} ${n.title}`
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((n) => {
                      const selected = memoryNotes(w, block).some(
                        (x) => x.id === n.id,
                      );
                      return (
                        <button
                          key={n.id}
                          aria-pressed={selected}
                          aria-label={`${selected ? '移除' : '添加'} Note ${n.id}`}
                          onClick={() => {
                            const ids = memoryNotes(w, block).map((x) => x.id);
                            update({
                              custom: true,
                              noteIds: selected
                                ? ids.filter((id) => id !== n.id)
                                : [...ids, n.id],
                            });
                          }}
                        >
                          <span>
                            <strong>{n.title}</strong>
                            <small>{n.id}</small>
                          </span>
                          {selected ? <Minus size={17} /> : <Plus size={17} />}
                        </button>
                      );
                    })}
                </div>
                <p className="field-help">
                  已选择 {memoryNotes(w, block).length} 条。仅发送 id
                  与标题，正文仍按 id 单独读取。
                </p>
              </>
            )}
          </div>
          <div className="memory-editor-actions">
            <button
              className="text-button danger"
              onClick={() => {
                onChange(w.blocks.filter((b) => b.id !== block.id));
                setEditing(null);
              }}
            >
              <Trash2 size={15} />
              删除组件
            </button>
            <Button onClick={() => setEditing(null)}>完成</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
