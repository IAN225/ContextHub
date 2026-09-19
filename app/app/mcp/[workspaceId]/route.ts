import { applicationDatabase, env } from '@/lib/application/server/runtime';
import { workspaceApplication } from '@/lib/application/server/workspaces';
import { mcpHandler } from '@/lib/mcp/server/handlers';
import {
  gatewayRequest,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
import { mcpRepository } from '@/lib/mcp/server/repository';
import type { SqlDatabase } from '@/lib/server/database';
async function handle(
  request: Request,
  context: { params: Promise<{ workspaceId: string }> },
) {
  if (request.headers.has('x-context-hub-gateway-key')) {
    try {
      const publicRequest = gatewayRequest(request, env as PublicMcpConfig);
      return mcpHandler(
        publicRequest,
        (await context.params).workspaceId,
        mcpRepository(
          (env as unknown as { DB: SqlDatabase }).DB,
          workspaceApplication(applicationDatabase()),
        ),
        undefined,
        new URL(publicRequest.url).origin,
      );
    } catch {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return mcpHandler(
    request,
    (await context.params).workspaceId,
    mcpRepository(
      (env as unknown as { DB: SqlDatabase }).DB,
      workspaceApplication(applicationDatabase()),
    ),
  );
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
