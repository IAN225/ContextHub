import { sha256Hex } from '../browser-compat.ts';
import { uid } from '../core/identity.ts';
import type { Attachment, WorkspaceContext } from '../core/model.ts';
import { createRequestScope } from '../client/request-scope.ts';
import type { HubState } from '../state/contracts.ts';
import { summaryWorkspace } from '../summary/engines.ts';
import { summaryRevision } from '../summary/planning.ts';
import { taskRequest } from './client.ts';
import type { BackgroundTask, SummaryTaskResult } from './contracts.ts';
const hash = (value: string) => sha256Hex(new TextEncoder().encode(value));
type Listing = {
  ready: boolean;
  tasks: BackgroundTask[];
  candidates: Record<string, SummaryTaskResult>;
};
export function createTaskSession(request = taskRequest) {
  let view = {
    tasks: [] as BackgroundTask[],
    ready: false,
    error: '',
    candidates: {} as Record<string, SummaryTaskResult>,
    submitting: false,
  };
  const serverView = view,
    listeners = new Set<() => void>(),
    reads = createRequestScope(),
    lifetime = createRequestScope();
  let data: HubState,
    enabled = true,
    writes = 0;
  const publish = (patch: Partial<typeof view>) => {
    view = { ...view, ...patch };
    listeners.forEach((fn) => fn());
  };
  async function refresh() {
    if (!enabled) return;
    reads.invalidate();
    const current = reads.capture();
    try {
      const result = await request<Listing>('list');
      if (enabled && current()) publish({ ...result, error: '' });
    } catch (error) {
      if (enabled && current())
        publish({
          error:
            error instanceof Error ? error.message : '后台任务服务不可用。',
        });
    }
  }
  async function mutate<T>(action: string, body: unknown): Promise<T> {
    if (!enabled) throw new Error('当前页面已暂停任务操作。');
    const current = lifetime.capture();
    ++writes;
    reads.invalidate();
    publish({ submitting: true, error: '' });
    try {
      const result = await request<T>(action, body);
      if (current() && enabled) {
        reads.invalidate();
        await refresh();
      }
      return result;
    } catch (error) {
      if (current() && enabled)
        publish({
          error: error instanceof Error ? error.message : '任务操作失败。',
        });
      throw error;
    } finally {
      --writes;
      if (enabled) publish({ submitting: writes > 0 });
    }
  }
  return {
    getSnapshot: () => view,
    getServerSnapshot: () => serverView,
    subscribe(this: void, fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setData(next: HubState) {
      data = next;
    },
    setEnabled(value: boolean) {
      enabled = value;
      lifetime.invalidate();
      reads.invalidate();
      if (value) publish({ submitting: writes > 0 });
    },
    refresh,
    refreshTask: (_id: string) => {
      void refresh();
    },
    async startSummary(this: void, workspace: WorkspaceContext) {
      return (
        await mutate<{ task: BackgroundTask }>('enqueue', {
          id: 's_' + uid(),
          kind: 'summary',
          workspaceId: workspace.id,
          engine: workspace.summaryEngine ?? 'custom',
          expectedHash: hash(summaryRevision(workspace)),
        })
      ).task;
    },
    async startAttachment(this: void, attachment: Attachment) {
      await mutate('enqueue', {
        id: uid(),
        kind: 'attachments',
        attachments: [attachment],
      });
    },
    async startWorkbench(
      this: void,
      workspace: WorkspaceContext,
      turnIds: string[],
      summaryId: string,
      instruction: string,
    ) {
      return (
        await mutate<{ task: BackgroundTask }>('enqueue', {
          id: uid(),
          kind: 'workbench',
          workspaceId: workspace.id,
          engine: 'custom',
          expectedHash: hash(summaryRevision(workspace)),
          turnIds,
          summaryId,
          instruction,
        })
      ).task;
    },
    async control(
      this: void,
      id: string,
      action: 'pause' | 'resume' | 'cancel',
    ) {
      const task = view.tasks.find((t) => t.id === id);
      let input: Record<string, unknown> = { id, action };
      if (action === 'resume' && task?.kind === 'summary') {
        const workspace = data.workspaces.find(
          (w) => w.id === task.workspace_id,
        );
        if (!workspace) throw new Error('原工作区已经不存在。');
        const scope = summaryWorkspace(workspace, task.engine ?? 'custom');
        input = {
          ...input,
          expectedHash: hash(summaryRevision(scope)),
          review: scope.config.review,
        };
      }
      await mutate('control', input);
    },
  };
}
