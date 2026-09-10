import { env } from 'cloudflare:workers';
import { mcpRepository } from '@/lib/mcp/server/repository';
import { manageMcp } from '@/lib/mcp/server/handlers';
import { oauthRepository } from '@/lib/mcp/server/oauth-repository';
import {
  publicOrigin,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return manageMcp(
    request,
    (await context.params).action,
    mcpRepository((env as unknown as { DB: D1Database }).DB),
    {
      repo: oauthRepository((env as unknown as { DB: D1Database }).DB),
      origin: publicOrigin(env as PublicMcpConfig),
    },
  );
}
export const POST = handle;
export const GET = handle;
