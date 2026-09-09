'use client';
import { useEffect, useState } from 'react';
import {
  compressBatch,
  coverage,
  uid,
  now,
  type Workspace,
} from '@/lib/domain';
import type { SendWorkspaceCommand } from '@/lib/hub-state';

export function useSummaryTask(
  w: Workspace,
  active: boolean,
  onCommand: SendWorkspaceCommand,
  onSelect: (id: string | null) => void,
) {
  const [request, setRequest] = useState({ active, running: false });
  const [message, setMessage] = useState('');
  if (request.active !== active) setRequest({ active, running: false });
  const running = active && request.running;
  const pending = coverage(w).pending.length;
  useEffect(() => {
    if (!active || !running) return;
    const timer = setTimeout(() => {
      const identity = { id: uid(), createdAt: now() };
      const next = compressBatch(w, identity);
      if (next === w) {
        setRequest({ active, running: false });
        setMessage('已到达近期原文保留窗口。');
        return;
      }
      onCommand({
        type: 'summary/compress',
        id: identity.id,
        at: identity.createdAt,
      });
      onSelect(next.activeId);
      if (w.config.review) {
        setRequest({ active, running: false });
        setMessage('本批检查点已保存，等待你检查后继续。');
      } else if (!coverage(next).pending.length) {
        setRequest({ active, running: false });
        setMessage('本次压缩完成，近期原文保持完整。');
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [active, running, w, onCommand, onSelect]);
  useEffect(() => {
    if (
      !active ||
      !w.config.auto ||
      !w.started ||
      !w.config.configured ||
      !pending ||
      running ||
      w.config.review
    )
      return;
    const timer = setTimeout(() => setRequest({ active, running: true }), 50);
    return () => clearTimeout(timer);
  }, [
    active,
    w.config.auto,
    w.config.configured,
    w.config.review,
    w.started,
    pending,
    running,
  ]);
  return {
    running,
    message,
    toggle() {
      setMessage('');
      if (running && w.config.auto)
        onCommand({ type: 'summary/config', patch: { auto: false } });
      setRequest({ active, running: !running });
    },
    stop(text?: string) {
      setRequest({ active, running: false });
      if (text) setMessage(text);
    },
  };
}
