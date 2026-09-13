'use client';
import {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Block } from '@/lib/domain';
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

// The drag session reads current blocks without restarting as they reorder.
export function useBlockReorder(
  items: Block[],
  onChange: (blocks: Block[]) => void,
) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dragPoint, setDragPoint] = useState({ x: 0, y: 0 });
  const list = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const latest = useRef({ blocks: items, onChange });
  useLayoutEffect(() => {
    latest.current = { blocks: items, onChange };
  }, [items, onChange]);
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
  }, [items]);
  function rememberPositions() {
    positions.current = new Map(
      Array.from(
        list.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [],
      ).map((e) => [e.dataset.blockId!, e.getBoundingClientRect().top]),
    );
  }
  function move(id: string, target: number) {
    const blocks = [...items],
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
      const { blocks: current, onChange: change } = latest.current;
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
      const blocks = [...current],
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
      const { blocks: current, onChange: change } = latest.current;
      change(
        [...current].sort(
          (a, b) => drag.original.indexOf(a.id) - drag.original.indexOf(b.id),
        ),
      );
      setDrag(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    };
    const tick = () => {
      const main = list.current?.closest<HTMLElement>(
        '.hub-dialog, .page-content',
      );
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
    window.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('keydown', key, true);
    };
    // Coordinates live in the handlers; keep the drag session stable while cards reorder.
  }, [drag]);

  function startDrag(id: string, e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    const rect = e.currentTarget
      .closest('[data-block-id]')!
      .getBoundingClientRect();
    setDragPoint({ x: e.clientX, y: e.clientY });
    setDrag({
      id,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - rect.x,
      offsetY: e.clientY - rect.y,
      width: rect.width,
      original: items.map((x) => x.id),
    });
  }
  return { list, drag, dragPoint, move, startDrag };
}
