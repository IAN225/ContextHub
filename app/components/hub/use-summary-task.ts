'use client';
import { useState } from 'react';
import type { Workspace } from '@/lib/domain';
import type { SendWorkspaceCommand } from '@/lib/hub-state';
import type { CommitWorkspaceCommand } from '@/lib/use-hub';
import type { GeneratedCheckpoint } from '@/lib/summary/planning';
import { useTaskQueue } from '@/lib/tasks/use-background-tasks';
import { taskLabels } from '@/lib/tasks/contracts';

// A chapter is now a controller/view of a durable job, not the job's owner.
export function useSummaryTask(
  w: Workspace,
  _active: boolean,
  onCommand: SendWorkspaceCommand,
  _onCommit: CommitWorkspaceCommand,
  _onSelect: (id: string | null) => void,
) {
  const queue = useTaskQueue();
  const [error, setError] = useState('');
  const current = queue?.tasks.find(
    (t) =>
      t.workspace_id === w.id &&
      t.kind === 'summary' &&
      t.status !== 'cancelled',
  );
  const running =
    !!current && ['queued', 'running', 'pausing'].includes(current.status);
  const candidate = current && queue?.candidates[current.id];
  const unsaved: GeneratedCheckpoint | null = candidate
    ? { expected: '', summary: candidate.summary, turnIds: candidate.turnIds }
    : null;
  const act = (action: () => Promise<unknown>) => {
    setError('');
    void action().catch((failure) =>
      setError(failure instanceof Error ? failure.message : '任务操作失败。'),
    );
  };
  return {
    running,
    unsaved,
    saving: queue?.submitting ?? false,
    message: current
      ? `${taskLabels[current.status]} · 已生成 ${current.step} 个检查点${current.step > current.acknowledged ? '，等待接收' : ''}`
      : '',
    error:
      error ||
      (current && queue?.problems[current.id]) ||
      current?.error ||
      queue?.error ||
      '',
    toggle() {
      if (!queue) return;
      if (running && current) {
        if (w.config.auto)
          onCommand({ type: 'summary/config', patch: { auto: false } });
        act(() => queue.control(current.id, 'pause'));
      } else if (current && ['paused', 'failed'].includes(current.status))
        act(() => queue.control(current.id, 'resume'));
      else act(() => queue.startSummary(w));
    },
    stop(_message?: string) {
      if (queue && current && running)
        act(() => queue.control(current.id, 'pause'));
    },
    retrySave() {
      if (queue && current) queue.retryReceive(current.id);
    },
    discardResult() {
      if (queue && current) act(() => queue.control(current.id, 'cancel'));
    },
  };
}
