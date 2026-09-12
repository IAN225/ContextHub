import { accountModelFetcher } from '@/lib/account/model-fetch';
import { env } from 'cloudflare:workers';
import { createSummaryHandler } from '@/lib/summary/server/handlers';
import type { SummaryEnvironment } from '@/lib/summary/server/config';
import { summarySettingsRepository } from '@/lib/summary/server/settings';
import { accountContext, type AccountEnvironment } from '@/lib/account/server';
const handleSummary = createSummaryHandler();
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as SummaryEnvironment &
    AccountEnvironment & { DB: D1Database };
  const account = accountContext(request, bindings);
  if (account instanceof Response) return account;
  return handleSummary(
    request,
    (await context.params).action,
    bindings,
    accountModelFetcher(bindings),
    summarySettingsRepository(bindings.DB, account ?? undefined),
    account ?? 'local',
  );
}
export const GET = handle;
export const POST = handle;
