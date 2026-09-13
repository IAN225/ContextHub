import { accountModelFetcher } from '@/lib/account/model-fetch';
import { env } from 'cloudflare:workers';
import { taskRepository } from '@/lib/tasks/server/repository';
import { taskHandler, type TaskEnvironment } from '@/lib/tasks/server/handlers';
import { summarySettingsRepository } from '@/lib/summary/server/settings';
import { accountContext, type AccountEnvironment } from '@/lib/account/server';
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
  const connection =
    action === 'enqueue'
      ? (
          await summarySettingsRepository(
            bindings.DB,
            account ?? undefined,
          ).read(bindings)
        ).env
      : {};
  return taskHandler(
    request,
    action,
    taskRepository(bindings.DB),
    { ...bindings, ...connection },
    accountModelFetcher(bindings),
    account ?? undefined,
    async (owner) =>
      (
        await summarySettingsRepository(
          bindings.DB,
          bindings.CONTEXT_HUB_ACCOUNT_MODE === '1' ? owner : undefined,
        ).read(bindings)
      ).env,
  );
}
export const GET = handle;
export const POST = handle;
