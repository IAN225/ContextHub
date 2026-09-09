'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { coverage, uid, now, type Workspace } from '@/lib/domain';
import type { SendWorkspaceCommand } from '@/lib/hub-state';
import type { CommitWorkspaceCommand } from '@/lib/use-hub';
import { requestSummary } from '@/lib/summary/client';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
  summaryRevision,
  type GeneratedCheckpoint,
} from '@/lib/summary/planning';

export function useSummaryTask(
  w: Workspace,
  active: boolean,
  onCommand: SendWorkspaceCommand,
  onCommit: CommitWorkspaceCommand,
  onSelect: (id: string | null) => void,
) {
  const [request, setRequest] = useState({ active, running: false, step: 0 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [unsaved, setUnsaved] = useState<GeneratedCheckpoint | null>(null);
  const [saving, setSaving] = useState(false);
  const blockedAuto = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const latest = useRef({ w, onCommand, onCommit, onSelect });
  useLayoutEffect(() => {
    latest.current = { w, onCommand, onCommit, onSelect };
  }, [w, onCommand, onCommit, onSelect]);
  if (request.active !== active)
    setRequest((value) => ({ ...value, active, running: false }));
  const running = active && request.running;
  const pending = coverage(w).pending.length;

  useEffect(() => {
    if (!active || !running) return;
    const aborter = new AbortController();
    controller.current = aborter;
    const pause = () => setRequest((value) => ({ ...value, running: false }));
    // Start after the effect so Strict Mode's discarded setup cannot call a model.
    void Promise.resolve().then(async () => {
      if (aborter.signal.aborted) return;
      const snapshot = latest.current.w;
      try {
        const plan = planCompression(snapshot);
        if (!plan) {
          setMessage('已到达近期原文保留窗口。');
          pause();
          return;
        }
        setMessage(`正在压缩 ${plan.turnIds.length} 个完整轮次，等待模型返回…`);
        setError('');
        const result = await requestSummary(plan.input, aborter.signal);
        if (aborter.signal.aborted) return;
        const generated = checkpointFromResult(plan, result, uid(), now());
        if (summaryRevision(latest.current.w) !== plan.expected) {
          blockedAuto.current = true;
          setUnsaved(generated);
          setError(
            '生成期间原文或配置发生变化，结果已保留在下方，但未推进水位。请复制结果后重新压缩。',
          );
          pause();
          return;
        }
        setMessage('摘要已生成，正在保存检查点…');
        setSaving(true);
        const saved = await latest.current.onCommit({
          type: 'summary/generated',
          generated,
        });
        setSaving(false);
        if (!saved) {
          blockedAuto.current = true;
          setUnsaved(generated);
          setError(
            '检查点未能保存，生成结果已保留。可以重试保存，无需再次调用模型。',
          );
          pause();
          return;
        }
        setUnsaved(null);
        if (aborter.signal.aborted) return;
        latest.current.onSelect(generated.summary.id);
        const next = applyGeneratedCheckpoint(snapshot, generated);
        if (snapshot.config.review || !coverage(next).pending.length) {
          setMessage(
            snapshot.config.review
              ? '本批检查点已保存，等待你检查后继续。'
              : '本次压缩完成，近期原文保持完整。',
          );
          pause();
        } else setRequest((value) => ({ ...value, step: value.step + 1 }));
      } catch (failure) {
        setSaving(false);
        if (aborter.signal.aborted) return;
        blockedAuto.current = true;
        setError(
          failure instanceof Error ? failure.message : '摘要压缩失败，已暂停。',
        );
        setMessage('');
        pause();
      }
    });
    return () => {
      aborter.abort();
      if (controller.current === aborter) controller.current = null;
    };
  }, [active, running, request.step]);

  useEffect(() => {
    blockedAuto.current = false;
  }, [w.config.auto]);
  useEffect(() => {
    if (
      !active ||
      !w.config.auto ||
      !(w.firstComplete ?? false) ||
      !w.config.configured ||
      !w.config.modelEnabled ||
      !pending ||
      running ||
      w.config.review ||
      blockedAuto.current ||
      unsaved
    )
      return;
    const timer = setTimeout(
      () =>
        setRequest((value) => ({
          ...value,
          active,
          running: true,
          step: value.step + 1,
        })),
      100,
    );
    return () => clearTimeout(timer);
  }, [
    active,
    w.config.auto,
    w.config.configured,
    w.config.modelEnabled,
    w.config.review,
    w.firstComplete,
    pending,
    running,
    unsaved,
  ]);
  return {
    running,
    message,
    error,
    unsaved,
    saving,
    toggle() {
      if (running) {
        controller.current?.abort();
        blockedAuto.current = true;
        setMessage('已暂停，已保存的检查点保留。');
        if (w.config.auto)
          onCommand({ type: 'summary/config', patch: { auto: false } });
      } else {
        blockedAuto.current = false;
        setError('');
        setMessage('');
      }
      setRequest((value) => ({
        ...value,
        active,
        running: !running,
        step: value.step + 1,
      }));
    },
    stop(text?: string) {
      controller.current?.abort();
      blockedAuto.current = true;
      setRequest((value) => ({ ...value, running: false }));
      if (text) setMessage(text);
    },
    async retrySave() {
      if (!unsaved || saving) return;
      if (summaryRevision(latest.current.w) !== unsaved.expected) {
        setError(
          '原文或配置已变化，无法把旧结果应用到当前水位。请复制下方结果后重新压缩。',
        );
        return;
      }
      setSaving(true);
      try {
        if (await onCommit({ type: 'summary/generated', generated: unsaved })) {
          onSelect(unsaved.summary.id);
          setUnsaved(null);
          setError('');
          setMessage('检查点已保存。');
        }
      } finally {
        setSaving(false);
      }
    },
    discardResult() {
      setUnsaved(null);
      setError('');
    },
  };
}
