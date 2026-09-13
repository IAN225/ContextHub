'use client';
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type UIEvent,
  type KeyboardEvent,
} from 'react';

// Selection stays mounted with the chapter, including when a filter has no results.
export function useTranscriptNavigation({
  initialCount,
  turnCount,
  active,
  filter,
  query,
}: {
  initialCount: number;
  turnCount: number;
  active: boolean;
  filter: string;
  query: string;
}) {
  const [index, setSelectedIndex] = useState(Math.max(0, initialCount - 1));
  const lane = useRef<HTMLDivElement>(null);
  const currentIndex = Math.min(index, Math.max(0, turnCount - 1));
  const [viewportIndex, setViewportIndex] = useState(currentIndex);
  const selectedIndex = useRef(currentIndex);
  const touchSession = useRef(false);
  useLayoutEffect(() => {
    selectedIndex.current = currentIndex;
  }, [currentIndex]);
  const setIndex = useCallback(
    (next: number) => {
      const bounded = Math.max(0, Math.min(turnCount - 1, next));
      // Discrete input owns a target, even while the rail is between ticks.
      // Updating the ref synchronously also preserves rapid wheel/key input.
      touchSession.current = false;
      selectedIndex.current = bounded;
      setSelectedIndex(bounded);
      lane.current?.scrollTo({
        left: bounded * 104,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    },
    [turnCount],
  );
  useLayoutEffect(() => {
    touchSession.current = false;
    if (active && lane.current) {
      lane.current.scrollTo({
        left: selectedIndex.current * 104,
        behavior: 'instant',
      });
    }
  }, [active, filter, query, turnCount]);
  useEffect(() => {
    if (!lane.current) return;
    const el = lane.current;
    let held = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastWheel = 0;
    let wheelDistance = 0;
    function settle() {
      clearTimeout(settleTimer);
      if (held || !touchSession.current) return;
      const next = Math.max(
        0,
        Math.min(turnCount - 1, Math.round(el.scrollLeft / 104)),
      );
      if (Math.abs(el.scrollLeft - next * 104) < 1) return;
      el.scrollTo({
        left: next * 104,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    }
    function scheduleSettle() {
      clearTimeout(settleTimer);
      if (!held && touchSession.current) settleTimer = setTimeout(settle, 180);
    }
    function touchStart() {
      held = true;
      touchSession.current = true;
      // A finger down interrupts either native momentum or a discrete jump.
      el.scrollTo({ left: el.scrollLeft, behavior: 'instant' });
      const next = Math.max(
        0,
        Math.min(turnCount - 1, Math.round(el.scrollLeft / 104)),
      );
      selectedIndex.current = next;
      setSelectedIndex(next);
      clearTimeout(settleTimer);
    }
    function touchEnd(e: TouchEvent) {
      held = e.touches.length > 0;
      scheduleSettle();
    }
    function scroll(e: WheelEvent) {
      if (e.ctrlKey) return;
      // Wheel input owns selection and positioning together; never allow a
      // second native pixel scroll after advancing the selected turn.
      e.preventDefault();
      clearTimeout(settleTimer);
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const time = performance.now();
      if (
        time - lastWheel > 160 ||
        Math.sign(delta) !== Math.sign(wheelDistance)
      )
        wheelDistance = 0;
      lastWheel = time;
      wheelDistance += delta;
      if (e.deltaMode === 0 && Math.abs(wheelDistance) < 24) return;
      const next = Math.max(
        0,
        Math.min(
          turnCount - 1,
          selectedIndex.current + Math.sign(wheelDistance),
        ),
      );
      wheelDistance = 0;
      setIndex(next);
    }
    el.addEventListener('wheel', scroll, { passive: false });
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('touchend', touchEnd, { passive: true });
    el.addEventListener('touchcancel', touchEnd, { passive: true });
    el.addEventListener('scroll', scheduleSettle, { passive: true });
    el.addEventListener('scrollend', settle);
    return () => {
      clearTimeout(settleTimer);
      el.removeEventListener('wheel', scroll);
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('touchend', touchEnd);
      el.removeEventListener('touchcancel', touchEnd);
      el.removeEventListener('scroll', scheduleSettle);
      el.removeEventListener('scrollend', settle);
    };
  }, [turnCount, active, setIndex]);
  function onScroll(e: UIEvent<HTMLDivElement>) {
    const next = Math.max(
      0,
      Math.min(turnCount - 1, Math.round(e.currentTarget.scrollLeft / 104)),
    );
    if (turnCount > 400) setViewportIndex(next);
    if (!touchSession.current) return;
    selectedIndex.current = next;
    setSelectedIndex(next);
  }
  function onPointKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(
          turnCount - 1,
          selectedIndex.current + (e.key === 'ArrowLeft' ? -1 : 1),
        ),
      );
      setIndex(next);
      const point = lane.current?.querySelector<HTMLButtonElement>(
        `[data-turn-index="${next}"]`,
      );
      point?.focus({ preventScroll: true });
    }
  }
  return {
    lane,
    currentIndex,
    viewportIndex,
    setIndex,
    onScroll,
    onPointKeyDown,
  };
}
