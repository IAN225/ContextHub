import { createHash } from 'node:crypto';
import type { SQLiteDatabase } from '../../server/sqlite.ts';
import type { HubCommand } from '../../state/contracts.ts';
import { decodePayload } from '../../storage/payload.ts';
import { summaryWorkspace } from '../../summary/engines.ts';
import { summaryRevision } from '../../summary/planning.ts';
import { resolveSummaryConnection } from '../../summary/server/config.ts';
import type {
  SummaryTaskState,
  TaskRecord,
  TaskResult,
} from '../../tasks/contracts.ts';
import { TaskError } from '../../tasks/contracts.ts';
import { taskRepository } from '../../tasks/server/repository.ts';
import type { WorkspaceApplication } from './workspaces.ts';
const digest = (text: string) =>
  createHash('sha256').update(text).digest('hex');
export function taskService(db: SQLiteDatabase, app: WorkspaceApplication) {
  const repository = taskRepository(db),
    sql = db.raw;
  function result(id: string, step: number): TaskResult | null {
    const rows = sql
      .prepare(
        'SELECT body FROM task_chunks WHERE task_id=? AND slot=? ORDER BY part',
      )
      .all(id, 'result:' + step);
    return rows.length
      ? decodePayload<TaskResult>(
          'task-result',
          JSON.parse(rows.map((r) => r.body).join('')),
        )
      : null;
  }
  function settle(id: string) {
    return db.transaction(() => {
      const task = sql
        .prepare('SELECT * FROM background_tasks WHERE id=?')
        .get(id) as TaskRecord | undefined;
      if (!task) return;
      for (let step = task.acknowledged + 1; step <= task.step; step++) {
        if (
          sql
            .prepare(
              'SELECT 1 FROM task_applications WHERE task_id=? AND step=?',
            )
            .get(id, step)
        )
          continue;
        const output = result(id, step);
        if (!output)
          throw new TaskError(
            'MISSING_RESULT',
            '任务结果缺失，已停止应用。',
            503,
          );
        let disposition = 'applied',
          reason: string | null = null;
        let snapshot;
        try {
          snapshot = app.read(task.owner_id);
        } catch {
          disposition = 'obsolete';
          reason = '账号已停用。';
        }
        if (
          task.status === 'cancelled' ||
          snapshot?.generation !== task.generation
        ) {
          disposition = 'obsolete';
          reason = '任务已取消或账号数据已恢复。';
        }
        if (disposition === 'applied' && snapshot) {
          let command: HubCommand;
          if (output.kind === 'summary') {
            const w = snapshot.state.workspaces.find(
              (w) => w.id === task.workspace_id,
            );
            if (!w) {
              disposition = 'obsolete';
              reason = '工作区已删除。';
            } else {
              const expected = summaryRevision(
                summaryWorkspace(w, task.engine ?? 'custom'),
              );
              let connectionChanged = false;
              if (task.connection_hash) {
                const row =
                  task.engine === 'reme'
                    ? sql
                        .prepare(
                          "SELECT value FROM summary_engine_settings WHERE owner_id=? AND engine='reme'",
                        )
                        .get('account:' + task.owner_id)
                    : sql
                        .prepare(
                          'SELECT value FROM account_summary_settings WHERE user_id=?',
                        )
                        .get(task.owner_id);
                try {
                  connectionChanged =
                    digest(
                      JSON.stringify(
                        resolveSummaryConnection(
                          summaryWorkspace(w, task.engine ?? 'custom').config,
                          row ? JSON.parse(String(row.value)) : {},
                        ),
                      ),
                    ) !== task.connection_hash;
                } catch {
                  connectionChanged = true;
                }
              }
              if (
                connectionChanged ||
                (output.engine ?? 'custom') !== (task.engine ?? 'custom') ||
                digest(expected) !== output.expectedHash
              ) {
                disposition = 'candidate';
                reason = '原文、摘要或配置已变化，结果已保存为候选。';
                app.apply(task.owner_id, snapshot, {
                  type: 'upload/add',
                  upload: {
                    id: 'candidate-' + id + '-' + step,
                    workspaceId: w.id,
                    title: '摘要候选',
                    summaryEngine: task.engine ?? 'custom',
                    kind: 'summary',
                    channel: 'workbench',
                    source: '后台任务',
                    turns: [],
                    summaryText: output.summary.text,
                    covered: output.summary.covered,
                    createdAt: new Date().toISOString(),
                  },
                });
              } else {
                command = {
                  type: 'task/summary',
                  taskId: id,
                  step,
                  workspaceId: w.id,
                  generated: {
                    engine: output.engine,
                    expected,
                    summary: output.summary,
                    turnIds: output.turnIds,
                  },
                };
                app.apply(task.owner_id, snapshot, command);
              }
            }
          } else if (output.kind === 'workbench') {
            if (
              !snapshot.state.workspaces.some((w) => w.id === task.workspace_id)
            ) {
              disposition = 'obsolete';
              reason = '工作区已删除。';
            } else
              app.apply(task.owner_id, snapshot, {
                type: 'task/workbench',
                taskId: id,
                step,
                upload: output.upload,
              });
          } else
            app.apply(task.owner_id, snapshot, {
              type: 'task/attachment',
              taskId: id,
              step,
              expected: output.expected,
              attachment: output.attachment,
            });
        }
        sql
          .prepare(
            'INSERT INTO task_applications(task_id,step,disposition,reason,created_at) VALUES(?,?,?,?,?)',
          )
          .run(id, step, disposition, reason, Date.now());
        sql
          .prepare(
            "UPDATE background_tasks SET acknowledged=?, status=CASE WHEN ?='candidate' THEN 'paused' WHEN ?='obsolete' THEN 'cancelled' ELSE status END,error=COALESCE(?,error),updated_at=? WHERE id=?",
          )
          .run(step, disposition, disposition, reason, Date.now(), id);
      }
    });
  }
  async function recover() {
    for (const row of sql
      .prepare('SELECT id FROM background_tasks WHERE step>acknowledged')
      .all()) {
      try {
        settle(String(row.id));
      } catch {
        sql
          .prepare(
            "UPDATE background_tasks SET status='paused',lease=NULL,lease_until=NULL,error='结果提交失败，原始结果已保留。',updated_at=? WHERE id=?",
          )
          .run(Date.now(), String(row.id));
      }
    }
  }
  return {
    ...repository,
    application: app,
    settle,
    recover,
    candidates(owner: string) {
      app.requireOwner(owner);
      const candidates: Record<string, TaskResult> = {};
      for (const row of sql
        .prepare(
          "SELECT a.task_id,a.step FROM task_applications a JOIN background_tasks t ON t.id=a.task_id WHERE t.owner_id=? AND t.status<>'cancelled' AND a.disposition='candidate' ORDER BY a.step",
        )
        .all(owner)) {
        const value = result(String(row.task_id), Number(row.step));
        if (value) candidates[String(row.task_id)] = value;
      }
      return candidates;
    },
    async enqueue(task: TaskRecord, state: unknown) {
      const snapshot = app.read(task.owner_id);
      if (
        task.generation !== undefined &&
        task.generation !== snapshot.generation
      )
        throw new TaskError(
          'GENERATION_CHANGED',
          '账号数据已恢复，请刷新后重新开始。',
          409,
        );
      return repository.enqueue(
        { ...task, generation: snapshot.generation },
        state,
      );
    },
    async claim(at = Date.now()) {
      await recover();
      for (let i = 0; i < 20; i++) {
        const task = await repository.claim(at);
        if (!task) return null;
        try {
          const current = app.read(task.owner_id);
          if (current.generation !== task.generation)
            throw new Error('账号数据已恢复。');
          if (task.kind === 'summary' || task.kind === 'workbench') {
            const workspace = current.state.workspaces.find(
              (w) => w.id === task.workspace_id,
            );
            const state = await repository.read<SummaryTaskState>(
              task.id,
              'state',
            );
            if (
              !workspace ||
              !state ||
              summaryRevision(
                summaryWorkspace(workspace, task.engine ?? 'custom'),
              ) !== summaryRevision(state.workspace)
            )
              throw new Error('任务输入已变化，请重新开始。');
          }
          return task;
        } catch (error) {
          await repository.fail(
            task,
            error instanceof Error ? error.message : '任务不可用。',
          );
        }
      }
      return null;
    },
    async progress(...args: Parameters<typeof repository.progress>) {
      const accepted = await repository.progress(...args);
      if (accepted) settle(args[0].id);
      return accepted;
    },
    async control(
      owner: string,
      id: string,
      action: 'pause' | 'resume' | 'cancel',
      resumeState?: unknown,
    ) {
      app.requireOwner(owner);
      if (action === 'resume')
        return repository.control(owner, id, action, resumeState);
      return db.transaction(() => {
        const task = sql
          .prepare('SELECT * FROM background_tasks WHERE id=? AND owner_id=?')
          .get(id, owner) as TaskRecord | undefined;
        if (!task) throw new TaskError('NOT_FOUND', '任务不存在。', 404);
        const snapshot = app.read(owner);
        if (
          task.kind === 'summary' &&
          snapshot.state.workspaces.some((w) => w.id === task.workspace_id)
        )
          app.apply(owner, snapshot, {
            type: 'workspace',
            workspaceId: task.workspace_id!,
            command: {
              type: 'summary/config',
              engine: task.engine,
              patch: { auto: false },
            },
          });
        if (action === 'cancel')
          sql
            .prepare(
              "UPDATE background_tasks SET status='cancelled',lease=NULL,lease_until=NULL,updated_at=? WHERE id=?",
            )
            .run(Date.now(), id);
        else
          sql
            .prepare(
              "UPDATE background_tasks SET status=CASE WHEN status='running' THEN 'pausing' ELSE 'paused' END,updated_at=? WHERE id=? AND status IN ('queued','running')",
            )
            .run(Date.now(), id);
        settle(id);
        return sql
          .prepare('SELECT * FROM background_tasks WHERE id=?')
          .get(id) as TaskRecord;
      });
    },
  };
}
export type TaskService = ReturnType<typeof taskService>;
