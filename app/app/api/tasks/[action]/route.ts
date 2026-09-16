import { accountModelFetcher } from '@/lib/account/model-fetch';
import { accountContext, type AccountEnvironment } from '@/lib/account/server';
import { summarySettingsRepository } from '@/lib/summary/server/settings';
import { taskHandler } from '@/lib/tasks/server/handlers';
import type { TaskEnvironment } from '@/lib/tasks/server/http';
import { taskRepository } from '@/lib/tasks/server/repository';
import { env } from 'cloudflare:workers';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as TaskEnvironment &
    AccountEnvironment & { DB: D1Database };
  const action = (await context.params).action;
  // Runner endpoints authenticate their private runner key inside taskHandler.
  const account = action.startsWith('runner-')
    ? null
    : accountContext(request, bindings);
  if (account instanceof Response) return account;
  return taskHandler(
    request,
    action,
    taskRepository(bindings.DB),
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
