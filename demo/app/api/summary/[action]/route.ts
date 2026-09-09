import { env } from 'cloudflare:workers';
import { createSummaryHandler } from '@/lib/summary/server/handlers';
import type { SummaryEnvironment } from '@/lib/summary/server/config';

const handleSummary = createSummaryHandler();
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handleSummary(
    request,
    (await context.params).action,
    env as SummaryEnvironment,
  );
}
export const GET = handle;
export const POST = handle;
