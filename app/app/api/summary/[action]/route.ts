import { accountModelFetcher } from '@/lib/account/model-fetch';
import { accountContext, type AccountEnvironment } from '@/lib/account/server';
import { parseSummaryEngine } from '@/lib/summary/engines';
import type { SummaryEnvironment } from '@/lib/summary/server/config';
import { createSummaryHandler } from '@/lib/summary/server/handlers';
import { summarySettingsRepository } from '@/lib/summary/server/settings';
import { env } from 'cloudflare:workers';
const handleSummary = createSummaryHandler();
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as SummaryEnvironment &
    AccountEnvironment & { DB: D1Database };
  const account = accountContext(request, bindings);
  if (account instanceof Response) return account;
  let engine;
  try {
    engine = parseSummaryEngine(
      new URL(request.url).searchParams.get('engine'),
    );
  } catch {
    return Response.json(
      { error: { code: 'INVALID_ENGINE', message: '未知摘要方案。' } },
      { status: 400 },
    );
  }
  return handleSummary(
    request,
    (await context.params).action,
    bindings,
    accountModelFetcher(bindings),
    summarySettingsRepository(bindings.DB, account ?? undefined, engine),
    (account ?? 'local') + ':' + engine,
  );
}
export const GET = handle;
export const POST = handle;
