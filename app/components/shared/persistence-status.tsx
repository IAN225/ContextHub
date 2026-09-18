'use client';
import { type ReactNode } from 'react';

export function SaveStatus({
  state,
  children,
}: {
  state: { ready: boolean; error: string; retry: () => Promise<void> };
  children: ReactNode;
}) {
  if (!state.error) return <>{children}</>;
  return (
    <span role="alert">
      {state.error}{' '}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          void state.retry();
        }}
      >
        {state.ready ? '重试保存' : '重试读取'}
      </button>
    </span>
  );
}

export function DraftBoundary({
  state,
  children,
}: {
  state: { ready: boolean; error: string; retry: () => Promise<void> };
  children: ReactNode;
}) {
  if (state.ready) return <>{children}</>;
  return (
    <output className="muted" aria-busy={!state.error}>
      <SaveStatus state={state}>正在读取草稿…</SaveStatus>
    </output>
  );
}
