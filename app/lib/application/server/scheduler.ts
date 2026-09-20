import {
  attachmentRevision,
  attachmentStatus,
} from '../../attachments/content.ts';
import { digest } from '../../server/crypto.ts';
import type { SQLiteDatabase } from '../../server/sqlite.ts';
import { coverage } from '../../summary/coverage.ts';
import {
  modelSummaryEngines,
  summaryWorkspace,
} from '../../summary/engines.ts';
import { summaryRevision } from '../../summary/planning.ts';
import { summarySettingsRepository } from '../../summary/server/settings.ts';
import type { TaskEnvironment } from '../../tasks/server/http.ts';
import { enqueueTask } from './enqueue-task.ts';
import { taskService } from './tasks.ts';
import { workspaceApplication } from './workspaces.ts';
const lastRuns = new WeakMap<object, number>();
export async function scheduleTasks(
  db: SQLiteDatabase,
  env: TaskEnvironment,
  at = Date.now(),
) {
  if (at - (lastRuns.get(db.raw) ?? 0) < 15000) return;
  lastRuns.set(db.raw, at);
  if (
    !db.raw
      .prepare('SELECT activated_at FROM instance_settings WHERE id=1')
      .get()?.activated_at
  )
    return;
  const app = workspaceApplication(db),
    tasks = taskService(db, app);
  const connection = async (owner: string, engine: 'custom' | 'reme') =>
    (await summarySettingsRepository(db, owner, engine).read({})).env;
  for (const row of db.raw
    .prepare("SELECT id FROM users WHERE disabled=0 AND status='active'")
    .all()) {
    const owner = String(row.id);
    try {
      const snapshot = app.read(owner);
      for (const original of snapshot.state.workspaces)
        for (const engine of modelSummaryEngines) {
          const w = summaryWorkspace(original, engine);
          if (
            !w.config.auto ||
            !w.config.modelEnabled ||
            w.config.review ||
            !w.firstComplete ||
            !coverage(w).pending.length
          )
            continue;
          const id =
            's_' +
            (await digest(
              JSON.stringify([
                owner,
                snapshot.generation,
                w.id,
                engine,
                summaryRevision(w),
              ]),
            ));
          if (await tasks.get(id)) continue;
          try {
            await enqueueTask(
              tasks,
              owner,
              { id, kind: 'summary', workspaceId: w.id, engine },
              env,
              connection,
            );
          } catch (error) {
            if (
              !(
                error instanceof Error &&
                'code' in error &&
                error.code === 'TASK_BUSY'
              )
            )
              throw error;
          }
        }
      const attachments = [
        ...snapshot.state.workspaces.flatMap((w) => w.turns),
        ...snapshot.state.uploads.flatMap((u) => u.turns),
      ]
        .filter((t) => t.status !== 'trash')
        .flatMap((t) => t.attachments ?? []);
      for (const attachment of attachments) {
        if (attachmentStatus(attachment) !== 'remote') continue;
        const id =
          'a_' +
          (await digest(
            JSON.stringify([
              owner,
              snapshot.generation,
              attachmentRevision(attachment),
            ]),
          ));
        if (await tasks.get(id)) continue;
        await enqueueTask(
          tasks,
          owner,
          { id, kind: 'attachments', attachments: [attachment] },
          env,
          connection,
        );
        break;
      }
    } catch (error) {
      // Errors are observable without recording model URLs, prompts or credentials.
      console.warn(
        'Task scheduling deferred',
        owner,
        error instanceof Error && 'code' in error
          ? String(error.code)
          : 'UNAVAILABLE',
      );
    }
  }
}
