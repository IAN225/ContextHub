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
import { coverage, uid, type Attachment, type Workspace } from '../domain';
import { attachmentRevision, attachmentStatus } from '../attachments';
import type { HubCommand, HubState } from '../hub-state';
import { summaryRevision } from '../summary/planning';
import { summaryTaskWorkspace } from './snapshot';
import { taskControl, taskRequest, taskResult } from './client';
import type { BackgroundTask, SummaryTaskResult } from './contracts';

async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
}
function media(state: HubState) {
  return [
    ...state.workspaces.flatMap((w) => w.turns),
    ...state.uploads.flatMap((u) => u.turns),
  ]
    .filter((t) => t.status !== 'trash')
    .flatMap((t) => t.attachments ?? []);
}
export function useBackgroundTasks(
  data: HubState,
  enabled: boolean,
  commit: (command: HubCommand) => Promise<boolean>,
) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [candidates, setCandidates] = useState<
    Record<string, SummaryTaskResult>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const latest = useRef({ data, commit, tasks, enabled });
  useLayoutEffect(() => {
    latest.current = { data, commit, tasks, enabled };
  }, [data, commit, tasks, enabled]);
  const session = useRef<Promise<void> | null>(null);
  const pendingIds = useRef(new Set<string>());
  const blocked = useRef(new Set<string>());
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
    }>('list');
    setTasks((current) =>
      JSON.stringify(current) === JSON.stringify(value.tasks)
        ? current
        : value.tasks,
    );
    setReady(value.ready);
    setError('');
    return value;
  }, [initialize]);
  const startSummary = useCallback(
    async (workspace: Workspace) => {
      await initialize();
      setSubmitting(true);
      setError('');
      try {
        const id = `s_${uid()}`;
        const response = await taskRequest<{ task: BackgroundTask }>(
          'enqueue',
          { id, kind: 'summary', workspace: summaryTaskWorkspace(workspace) },
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
      workspace: Workspace,
      turnIds: string[],
      summaryId: string,
      instruction: string,
    ) => {
      await initialize();
      const { task } = await taskRequest<{ task: BackgroundTask }>('enqueue', {
        id: uid(),
        kind: 'workbench',
        workspace: summaryTaskWorkspace(workspace),
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
      if (action !== 'resume' && task?.kind === 'summary') {
        const workspace = latest.current.data.workspaces.find(
          (w) => w.id === task.workspace_id,
        );
        if (
          workspace?.config.auto &&
          !(await latest.current.commit({
            type: 'workspace',
            workspaceId: workspace.id,
            command: { type: 'summary/config', patch: { auto: false } },
          }))
        )
          throw new Error('自动运行设置未能保存，请重试后再停止任务。');
      }
      if (action === 'resume' && task?.kind === 'summary') {
        const workspace = latest.current.data.workspaces.find(
          (w) => w.id === task.workspace_id,
        );
        if (!workspace) throw new Error('原手账已经不存在。');
        await taskRequest('control', {
          id,
          action,
          expectedHash: await hash(summaryRevision(workspace)),
          review: workspace.config.review,
        });
      } else await taskControl(id, action);
      blocked.current.delete(id);
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
  const receive = useCallback(async (list: BackgroundTask[]) => {
    for (const task of list) {
      if (
        !latest.current.enabled ||
        task.status === 'cancelled' ||
        blocked.current.has(task.id)
      )
        continue;
      const saved = latest.current.data.taskReceipts?.[task.id] ?? 0;
      if (saved > task.acknowledged) {
        for (
          let step = task.acknowledged + 1;
          step <= Math.min(saved, task.step);
          step++
        )
          await taskRequest('ack', { id: task.id, step });
        return;
      }
      if (task.step <= saved) continue;
      const step = saved + 1;
      const { result } = await taskResult(task.id, step);
      if (!result) {
        blocked.current.add(task.id);
        setProblems((values) => ({
          ...values,
          [task.id]: '结果已在其他页面接收或已清理，请刷新当前页面。',
        }));
        continue;
      }
      try {
        let command: HubCommand;
        if (result.kind === 'summary') {
          const w = latest.current.data.workspaces.find(
            (w) => w.id === task.workspace_id,
          );
          if (!w) throw new Error('原手账已不存在，结果暂未应用。');
          const expected = summaryRevision(w);
          if ((await hash(expected)) !== result.expectedHash) {
            setCandidates((values) => ({ ...values, [task.id]: result }));
            throw new Error(
              '原文或配置已变化，后台摘要没有覆盖当前手账。可复制结果，或取消旧任务后重新整理。',
            );
          }
          command = {
            type: 'task/summary',
            taskId: task.id,
            step,
            workspaceId: w.id,
            generated: {
              expected,
              summary: result.summary,
              turnIds: result.turnIds,
            },
          };
        } else if (result.kind === 'workbench')
          command = {
            type: 'task/workbench',
            taskId: task.id,
            step,
            upload: result.upload,
          };
        else
          command = {
            type: 'task/attachment',
            taskId: task.id,
            step,
            expected: result.expected,
            attachment: result.attachment,
          };
        if (!latest.current.enabled) return;
        if (!(await latest.current.commit(command)))
          throw new Error(
            '结果未能保存到浏览器。服务端结果仍保留，可重试接收。',
          );
        await taskRequest('ack', { id: task.id, step });
      } catch (failure) {
        blocked.current.add(task.id);
        if (
          task.kind === 'summary' &&
          ['running', 'queued'].includes(task.status)
        )
          await taskControl(task.id, 'pause');
        setProblems((values) => ({
          ...values,
          [task.id]:
            failure instanceof Error ? failure.message : '接收结果失败。',
        }));
      }
      return; // Let React publish the durable state before applying the next batch.
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      busy = false;
    const poll = async () => {
      if (busy || disposed) return;
      busy = true;
      const work = async () => {
        try {
          const value = await refresh();
          if (disposed || !latest.current.enabled) return;
          await receive(value.tasks);
          if (!value.ready || disposed) return;
          const state = latest.current.data;
          for (const w of state.workspaces) {
            if (
              w.config.auto &&
              w.firstComplete &&
              w.config.modelEnabled &&
              !w.config.review &&
              coverage(w).pending.length &&
              !value.tasks.some(
                (t) =>
                  t.workspace_id === w.id &&
                  t.kind === 'summary' &&
                  t.status !== 'cancelled' &&
                  (t.status !== 'completed' || t.step > t.acknowledged),
              )
            ) {
              try {
                await startSummary(w);
              } catch {
                /* The visible task error explains why. */
              }
              return;
            }
          }
          if (
            value.tasks.filter(
              (t) => !['completed', 'cancelled'].includes(t.status),
            ).length >= 20
          )
            return;
          for (const attachment of media(state)) {
            if (attachmentStatus(attachment) !== 'remote') continue;
            const id = `a_${await hash(attachmentRevision(attachment))}`;
            if (
              pendingIds.current.has(id) ||
              value.tasks.some((t) => t.id === id)
            )
              continue;
            await startAttachment(attachment, true);
            break;
          }
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
        if (navigator.locks)
          await navigator.locks.request(
            'context-hub-background-receiver',
            { ifAvailable: true },
            async (lock) => {
              if (lock) await work();
            },
          );
        else await work();
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
  }, [enabled, refresh, receive, startAttachment, startSummary]);
  const retryReceive = useCallback((id: string) => {
    blocked.current.delete(id);
    setProblems((values) => {
      const next = { ...values };
      delete next[id];
      return next;
    });
  }, []);
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
    retryReceive,
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
