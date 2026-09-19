'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { attachmentRevision } from '../attachments';
import { sha256Hex } from '../browser-compat';
import { uid } from '../core/identity.ts';
import { type Attachment, type WorkspaceContext } from '../core/model.ts';
import { type HubState } from '../state/contracts.ts';
import { summaryWorkspace } from '../summary/engines';
import { summaryRevision } from '../summary/planning';
import { taskControl, taskRequest } from './client';
import type { BackgroundTask, SummaryTaskResult } from './contracts';

async function hash(value: string) {
  return sha256Hex(new TextEncoder().encode(value));
}
export function useBackgroundTasks(data: HubState, enabled: boolean) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<
    Record<string, SummaryTaskResult>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef({ data, tasks, enabled });
  useLayoutEffect(() => {
    latest.current = { data, tasks, enabled };
  }, [data, tasks, enabled]);
  const session = useRef<Promise<void> | null>(null);
  const pendingIds = useRef(new Set<string>());
  const initialize = useCallback(() => {
    if (!session.current)
      session.current = taskRequest<{ ready: boolean }>('session', {})
        .then((value) => {
          setReady(value.ready);
        })
        .catch((failure) => {
          session.current = null;
          throw failure;
        });
    return session.current;
  }, []);
  const refresh = useCallback(async () => {
    await initialize();
    const value = await taskRequest<{
      ready: boolean;
      tasks: BackgroundTask[];
      candidates: Record<string, SummaryTaskResult>;
    }>('list');
    setTasks((current) =>
      JSON.stringify(current) === JSON.stringify(value.tasks)
        ? current
        : value.tasks,
    );
    setReady(value.ready);
    setCandidates(value.candidates);
    setProblems(
      Object.fromEntries(
        value.tasks.filter((t) => t.error).map((t) => [t.id, t.error!]),
      ),
    );
    setError('');
    return value;
  }, [initialize]);
  const startSummary = useCallback(
    async (workspace: WorkspaceContext) => {
      await initialize();
      setSubmitting(true);
      setError('');
      try {
        const id = `s_${uid()}`;
        const response = await taskRequest<{ task: BackgroundTask }>(
          'enqueue',
          {
            id,
            kind: 'summary',
            workspaceId: workspace.id,
            engine: workspace.summaryEngine ?? 'custom',
            expectedHash: await hash(summaryRevision(workspace)),
          },
        );
        setTasks((values) => [
          response.task,
          ...values.filter((t) => t.id !== response.task.id),
        ]);
        return response.task;
      } catch (failure) {
        const message =
          failure instanceof Error ? failure.message : '任务未能入队。';
        setError(message);
        throw failure;
      } finally {
        setSubmitting(false);
      }
    },
    [initialize],
  );
  const startAttachment = useCallback(
    async (attachment: Attachment, automatic = false) => {
      const id = automatic
        ? `a_${await hash(attachmentRevision(attachment))}`
        : uid();
      if (
        pendingIds.current.has(id) ||
        (automatic && latest.current.tasks.some((t) => t.id === id))
      )
        return;
      pendingIds.current.add(id);
      try {
        await initialize();
        const response = await taskRequest<{ task: BackgroundTask }>(
          'enqueue',
          { id, kind: 'attachments', attachments: [attachment] },
        );
        setTasks((values) => [
          response.task,
          ...values.filter((t) => t.id !== id),
        ]);
      } catch (failure) {
        pendingIds.current.delete(id);
        throw failure;
      }
    },
    [initialize],
  );
  const startWorkbench = useCallback(
    async (
      workspace: WorkspaceContext,
      turnIds: string[],
      summaryId: string,
      instruction: string,
    ) => {
      await initialize();
      const { task } = await taskRequest<{ task: BackgroundTask }>('enqueue', {
        id: uid(),
        kind: 'workbench',
        workspaceId: workspace.id,
        engine: 'custom',
        expectedHash: await hash(summaryRevision(workspace)),
        turnIds,
        summaryId,
        instruction,
      });
      setTasks((values) => [task, ...values.filter((t) => t.id !== task.id)]);
      return task;
    },
    [initialize],
  );
  const control = useCallback(
    async (id: string, action: 'pause' | 'resume' | 'cancel') => {
      const task = latest.current.tasks.find((t) => t.id === id);
      if (action === 'resume' && task?.kind === 'summary') {
        const workspace = latest.current.data.workspaces.find(
          (w) => w.id === task.workspace_id,
        );
        if (!workspace) throw new Error('原工作区已经不存在。');
        await taskRequest('control', {
          id,
          action,
          expectedHash: await hash(
            summaryRevision(
              summaryWorkspace(workspace, task.engine ?? 'custom'),
            ),
          ),
          review: summaryWorkspace(workspace, task.engine ?? 'custom').config
            .review,
        });
      } else await taskControl(id, action);
      setProblems((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (action === 'cancel')
        setCandidates((current) => {
          const next = { ...current };
          delete next[id];
          return next;
        });
      await refresh();
    },
    [refresh],
  );
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      busy = false;
    const poll = async () => {
      if (busy || disposed) return;
      busy = true;
      const work = async () => {
        try {
          await refresh();
          if (disposed || !latest.current.enabled) return;
        } catch (failure) {
          if (!disposed)
            setError(
              failure instanceof Error
                ? failure.message
                : '后台任务服务不可用。',
            );
        }
      };
      try {
        await work();
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1500);
    window.addEventListener('focus', poll);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [enabled, refresh]);
  const refreshTask = useCallback(
    (id: string) => {
      setProblems((values) => {
        const next = { ...values };
        delete next[id];
        return next;
      });
      void refresh();
    },
    [refresh],
  );
  return {
    tasks,
    ready,
    error,
    problems,
    candidates,
    submitting,
    startSummary,
    startWorkbench,
    startAttachment,
    control,
    refreshTask,
    refresh,
  };
}
export type BackgroundTasks = ReturnType<typeof useBackgroundTasks>;
export const BackgroundTasksContext = createContext<BackgroundTasks | null>(
  null,
);
export function useTaskQueue() {
  return useContext(BackgroundTasksContext);
}
