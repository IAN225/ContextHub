'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fitPetPosition,
  PET_SIZE,
  type FloatingPoint,
} from '@/lib/floating-position';

const positionKey = 'context-hub-inbox-pet-position';
function viewport() {
  const visible = window.visualViewport;
  return {
    width: visible?.width ?? window.innerWidth,
    height: visible?.height ?? window.innerHeight,
    left: visible?.offsetLeft ?? 0,
    top: visible?.offsetTop ?? 0,
  };
}

export function InboxPet({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const [point, setPoint] = useState<FloatingPoint | null>(null);
  const [dragging, setDragging] = useState(false);
  const position = useRef<FloatingPoint | null>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    origin: FloatingPoint;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const moveTo = useCallback((next: FloatingPoint) => {
    const fitted = fitPetPosition(next, viewport());
    position.current = fitted;
    setPoint(fitted);
  }, []);
  const remember = () => {
    try {
      localStorage.setItem(positionKey, JSON.stringify(position.current));
    } catch {
      /* Moving remains available when browser storage is disabled. */
    }
  };
  useEffect(() => {
    const visible = viewport();
    let saved = {
      x: visible.left + visible.width - PET_SIZE - 20,
      y: visible.top + visible.height - PET_SIZE - 24,
    };
    try {
      const value = JSON.parse(localStorage.getItem(positionKey) ?? 'null');
      if (value && Number.isFinite(value.x) && Number.isFinite(value.y))
        saved = value;
    } catch {
      /* Ignore stale local preferences. */
    }
    const initialFrame = requestAnimationFrame(() => moveTo(saved));
    const resize = () => {
      if (position.current) moveTo(position.current);
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      cancelAnimationFrame(initialFrame);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, [moveTo]);
  const waiting = count > 0;
  const label = waiting
    ? `收件箱，${count} 份上下文待归档`
    : '收件箱，暂无新上下文';
  return (
    <button
      className={`inbox-pet-button${dragging ? ' is-dragging' : ''}`}
      style={point ? { left: point.x, top: point.y } : undefined}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        const origin = position.current ?? { x: box.x, y: box.y };
        suppressClick.current = false;
        drag.current = {
          pointer: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          origin,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const session = drag.current;
        if (!session || session.pointer !== event.pointerId) return;
        const dx = event.clientX - session.x;
        const dy = event.clientY - session.y;
        if (!session.moved && Math.hypot(dx, dy) < 6) return;
        session.moved = true;
        suppressClick.current = true;
        setDragging(true);
        moveTo({ x: session.origin.x + dx, y: session.origin.y + dy });
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        if (drag.current.moved) remember();
        drag.current = null;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) moveTo(drag.current.origin);
        drag.current = null;
        suppressClick.current = true;
        setDragging(false);
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        moveTo(drag.current.origin);
        drag.current = null;
        suppressClick.current = true;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          moveTo(drag.current.origin);
          drag.current = null;
          suppressClick.current = true;
          setDragging(false);
          return;
        }
        const steps: Record<string, FloatingPoint> = {
          ArrowLeft: { x: -16, y: 0 },
          ArrowRight: { x: 16, y: 0 },
          ArrowUp: { x: 0, y: -16 },
          ArrowDown: { x: 0, y: 16 },
        };
        const step = steps[event.key];
        if (!step || !position.current) return;
        event.preventDefault();
        moveTo({
          x: position.current.x + step.x,
          y: position.current.y + step.y,
        });
        remember();
      }}
      onClick={(event) => {
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false;
          return;
        }
        suppressClick.current = false;
        onClick();
      }}
      aria-label={label}
      title={`${label} · 拖动移动，点击打开；方向键也可移动`}
    >
      <svg
        className="inbox-pet"
        viewBox="0 0 24 24"
        shapeRendering="crispEdges"
        aria-hidden="true"
        data-mail={waiting ? 'waiting' : 'empty'}
      >
        <path
          fill="#697257"
          d="M4 3h5v3h6V3h5v13h-2v5H6v-5H4zM2 14h2v5H2zM4 19h3v2H4z"
        />
        <path fill="#d9d0ab" d="M6 5h2v4h8V5h2v10h-2v4H8v-4H6z" />
        <path fill="#b69b7d" d="M6 5h2v3H6zM16 5h2v3h-2z" />
        {waiting ? (
          <>
            <path fill="#4c5744" d="M8 10h2v2H8zM14 10h2v2h-2zM11 12h2v1h-2z" />
            <path fill="#f8f1d8" d="M5 15h14v7H5z" />
            <path
              fill="#ba965b"
              d="M5 15h14v1H5zM5 21h14v1H5zM5 16h1v5H5zM18 16h1v5h-1zM6 16h2v1H6zM8 17h2v1H8zM10 18h4v1h-4zM14 17h2v1h-2zM16 16h2v1h-2z"
            />
            <path fill="#ba965b" d="M20 2h2v4h-2zM20 7h2v2h-2z" />
          </>
        ) : (
          <path fill="#4c5744" d="M8 11h3v1H8zM13 11h3v1h-3zM11 13h2v1h-2z" />
        )}
      </svg>
      <span className="inbox-pet-label">收件箱</span>
      {waiting && (
        <span className="inbox-pet-count" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
