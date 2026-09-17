import { now, uid } from '../../core/identity.ts';
import { digest } from '../../server/crypto.ts';
import { coverage } from '../../summary/coverage.ts';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
  planWorkbench,
  summaryRevision,
} from '../../summary/planning.ts';
import { generateSummary } from '../../summary/server/service.ts';
import {
  TaskError,
  type SummaryTaskState,
  type TaskRecord,
  type WorkbenchTaskState,
} from '../contracts.ts';
import { connectionHash, type TaskEnvironment } from './http.ts';
import type { TaskRepository } from './repository.ts';
export async function runSummary(
  task: TaskRecord,
  repo: TaskRepository,
  env: TaskEnvironment,
  fetcher?: typeof fetch,
) {
  try {
    const state = await repo.read<SummaryTaskState>(task.id, 'state');
    if (!state)
      throw new TaskError('MISSING_TASK_DATA', '任务输入已经不可用。');
    const w = state.workspace;
    if ((await connectionHash(w, env)) !== task.connection_hash)
      throw new TaskError(
        'CONNECTION_CHANGED',
        '本地模型连接已变化。请取消旧任务，再按当前连接开始压缩。',
      );
    if (task.kind === 'workbench') {
      const input = state as WorkbenchTaskState;
      const plan = planWorkbench(
        w,
        w.turns.filter(
          (t) => input.turnIds.includes(t.id) && t.status === 'normal',
        ),
        w.summaries.find((s) => s.id === input.summaryId),
        input.instruction,
      );
      const result = await generateSummary(plan.input, env, undefined, fetcher);
      await repo.progress(
        task,
        state,
        {
          kind: 'workbench',
          upload: {
            id: `candidate-${task.id}`,
            title: '工作台候选摘要',
            kind: 'summary',
            channel: 'workbench',
            source: `摘要工作台 · ${result.model}`,
            turns: [],
            workspaceId: w.id,
            covered: plan.covered,
            summaryText: result.text,
            createdAt: now(),
          },
        },
        'completed',
      );
      return;
    }
    const plan = planCompression(w);
    if (!plan)
      throw new TaskError('NO_PENDING_TURNS', '任务已没有待压缩轮次。');
    // This request is owned by the local runner, never a browser tab lifecycle.
    const response = await generateSummary(plan.input, env, undefined, fetcher);
    const generated = checkpointFromResult(plan, response, uid(), now());
    const next = applyGeneratedCheckpoint(w, generated);
    await repo.progress(
      task,
      { workspace: next },
      {
        kind: 'summary',
        engine: w.summaryEngine ?? 'custom',
        expectedHash: await digest(summaryRevision(w)),
        summary: generated.summary,
        turnIds: generated.turnIds,
      },
      !coverage(next).pending.length
        ? 'completed'
        : w.config.review
          ? 'paused'
          : 'queued',
    );
  } catch (error) {
    await repo.fail(
      task,
      error instanceof Error && 'code' in error
        ? error.message
        : '摘要任务未完成，已暂停。请检查本地服务后手动重试。',
    );
  }
}
