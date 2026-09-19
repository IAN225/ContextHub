'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fitPetPosition,
  PET_SIZE,
  type FloatingPoint,
} from '../../lib/floating-position.ts';
import { builtinPet } from '../../lib/pets/builtin.ts';
import { petState } from '../../lib/pets/contracts.ts';
import { usePetPreferences } from '../../lib/pets/use-preferences.ts';
import { accountRepository } from '../../lib/storage/account-repository.ts';
import { PetFramePlayer } from '../pets/index.ts';

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
  const [preferences] = usePetPreferences();
  const pack =
    preferences.active === 'custom' && preferences.custom
      ? preferences.custom
      : builtinPet;
  const [pressed, setPressed] = useState(false);
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
      void accountRepository
        .write([{ key: positionKey, value: position.current }])
        .catch(() => {});
    } catch {
      /* Moving remains available when browser storage is disabled. */
    }
  };
  useEffect(() => {
    const visible = viewport();
    const saved = {
      x: visible.left + visible.width - PET_SIZE - 20,
      y: visible.top + visible.height - PET_SIZE - 24,
    };
    const initialFrame = requestAnimationFrame(() => moveTo(saved));
    let alive = true;
    void accountRepository
      .read(positionKey)
      .then((raw) => {
        const value = raw as FloatingPoint | null;
        if (
          alive &&
          value &&
          Number.isFinite(value.x) &&
          Number.isFinite(value.y)
        )
          moveTo(value);
      })
      .catch(() => {});
    const resize = () => {
      if (position.current) moveTo(position.current);
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    return () => {
      alive = false;
      cancelAnimationFrame(initialFrame);
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, [moveTo]);
  const waiting = count > 0;
  const label = waiting
    ? `收件箱，${count} 项待处理收件`
    : '收件箱，暂无待处理收件';
  return (
    <button
      className={`inbox-pet-button${dragging ? ' is-dragging' : ''}`}
      style={point ? { left: point.x, top: point.y } : undefined}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        setPressed(true);
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
        setPressed(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) moveTo(drag.current.origin);
        drag.current = null;
        suppressClick.current = true;
        setDragging(false);
        setPressed(false);
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        moveTo(drag.current.origin);
        drag.current = null;
        suppressClick.current = true;
        setDragging(false);
        setPressed(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          moveTo(drag.current.origin);
          drag.current = null;
          suppressClick.current = true;
          setDragging(false);
          setPressed(false);
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
      <PetFramePlayer pack={pack} state={petState(pressed, dragging, count)} />
      <span className="inbox-pet-label">收件箱</span>
      {waiting && (
        <span className="inbox-pet-count" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
