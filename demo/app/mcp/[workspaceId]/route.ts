import { env } from 'cloudflare:workers';
import { mcpRepository } from '@/lib/mcp/server/repository';
import { mcpHandler } from '@/lib/mcp/server/handlers';
import {
  gatewayRequest,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
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
        mcpRepository((env as unknown as { DB: D1Database }).DB),
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
    mcpRepository((env as unknown as { DB: D1Database }).DB),
  );
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
