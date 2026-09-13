import { env } from 'cloudflare:workers';
import {
  gatewayRequest,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
import { oauthHandler } from '@/lib/mcp/server/oauth';
import { oauthRepository } from '@/lib/mcp/server/oauth-repository';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  try {
    return oauthHandler(
      gatewayRequest(request, env as PublicMcpConfig),
      (await context.params).action,
      oauthRepository((env as unknown as { DB: D1Database }).DB),
    );
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
}
export const GET = handle;
export const POST = handle;
