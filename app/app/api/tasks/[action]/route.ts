import { accountModelFetcher } from '@/lib/account/model-fetch';
import { accountContext, type AccountEnvironment } from '@/lib/account/server';
import { applicationDatabase, env } from '@/lib/application/server/runtime';
import { scheduleTasks } from '@/lib/application/server/scheduler';
import { taskService } from '@/lib/application/server/tasks';
import { workspaceApplication } from '@/lib/application/server/workspaces';
import type { SqlDatabase } from '@/lib/server/database';
import { summarySettingsRepository } from '@/lib/summary/server/settings';
import { taskHandler } from '@/lib/tasks/server/handlers';
import type { TaskEnvironment } from '@/lib/tasks/server/http';
import { requireRunner } from '@/lib/tasks/server/http';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as TaskEnvironment &
    AccountEnvironment & { DB: SqlDatabase };
  const action = (await context.params).action;
  // Runner endpoints authenticate their private runner key inside taskHandler.
  const account = action.startsWith('runner-')
    ? null
    : accountContext(request, bindings);
  if (account instanceof Response) return account;
  if (action === 'runner-claim') {
    await requireRunner(request, bindings);
    await scheduleTasks(applicationDatabase(), bindings);
  }
  return taskHandler(
    request,
    action,
    taskService(
      applicationDatabase(),
      workspaceApplication(applicationDatabase()),
    ),
    bindings,
    accountModelFetcher(bindings),
    account ?? undefined,
    async (owner, engine) =>
      (
        await summarySettingsRepository(
          bindings.DB,
          bindings.CONTEXT_HUB_ACCOUNT_MODE === '1' ? owner : undefined,
          engine,
        ).read(bindings)
      ).env,
  );
}
export const GET = handle;
export const POST = handle;
