import { env } from 'cloudflare:workers';
import { mcpRepository } from '@/lib/mcp/server/repository';
import { manageMcp } from '@/lib/mcp/server/handlers';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return manageMcp(
    request,
    (await context.params).action,
    mcpRepository((env as unknown as { DB: D1Database }).DB),
  );
}
export const POST = handle;
export const GET = handle;
