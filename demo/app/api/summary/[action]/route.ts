import { env } from 'cloudflare:workers';
import { createSummaryHandler } from '@/lib/summary/server/handlers';
import type { SummaryEnvironment } from '@/lib/summary/server/config';
import { summarySettingsRepository } from '@/lib/summary/server/settings';

const handleSummary = createSummaryHandler();
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as SummaryEnvironment & { DB: D1Database };
  return handleSummary(
    request,
    (await context.params).action,
    bindings,
    undefined,
    summarySettingsRepository(bindings.DB),
  );
}
export const GET = handle;
export const POST = handle;
