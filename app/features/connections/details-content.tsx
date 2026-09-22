'use client';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** Measure the natural mobile content so every authorization step can resize smoothly. */
export function ConnectionDetailsContent({
  children,
}: {
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = ref.current;
    const panel = content?.parentElement;
    if (!content || !panel) return;
    const measure = () =>
      panel.style.setProperty(
        '--connection-content-height',
        `${content.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="connection-details-content" ref={ref}>
      {children}
    </div>
  );
}
