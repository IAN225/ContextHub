import { env } from 'cloudflare:workers';
import { mcpRepository } from '@/lib/mcp/server/repository';
import { mcpHandler } from '@/lib/mcp/server/handlers';
async function handle(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  return mcpHandler(
    request,
    (await context.params).workspaceId,
    mcpRepository((env as unknown as { DB: D1Database }).DB),
  );
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
