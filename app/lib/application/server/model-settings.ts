import type { SQLiteDatabase } from '../../server/sqlite.ts';
import { SummaryError } from '../../summary/contracts.ts';
import { summaryWorkspace, type SummaryEngine } from '../../summary/engines.ts';
import { summarySettingsRepository } from '../../summary/server/settings.ts';
import { workspaceApplication } from './workspaces.ts';
/** Changing credentials revokes existing automatic execution consent in the same commit. */
export function modelSettingsService(
  db: SQLiteDatabase,
  owner: string,
  engine: SummaryEngine,
) {
  const app = workspaceApplication(db);
  const repo = summarySettingsRepository(
    db,
    owner,
    engine,
    async (query, parameters) =>
      db.transaction(() => {
        const before = app.read(owner);
        const changes = Number(
          db.raw.prepare(query).run(...parameters).changes,
        );
        if (!changes)
          throw new SummaryError(
            'CONNECTION_CHANGED',
            '模型连接已更新，请重新读取。',
            409,
          );
        let state = before;
        for (const w of before.state.workspaces) {
          const view = summaryWorkspace(w, engine);
          if (view.config.auto) {
            app.apply(owner, state, {
              type: 'workspace',
              workspaceId: w.id,
              command: {
                type: 'summary/config',
                engine,
                patch: { auto: false },
              },
            });
            state = app.read(owner);
          }
        }
        db.raw
          .prepare(
            "UPDATE background_tasks SET status=CASE WHEN status='running' THEN 'pausing' ELSE 'paused' END,error='模型连接已变化，请检查后重新开始。',updated_at=? WHERE owner_id=? AND engine=? AND kind IN ('summary','workbench') AND status IN ('running','queued')",
          )
          .run(Date.now(), owner, engine);
        return { meta: { changes } };
      }),
  );
  return {
    ...repo,
    read: (env: Parameters<typeof repo.read>[0]) => {
      app.requireOwner(owner);
      return repo.read(env);
    },
  };
}
