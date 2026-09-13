import { env } from 'cloudflare:workers';
import { mcpRepository } from '@/lib/mcp/server/repository';
import { manageMcp } from '@/lib/mcp/server/handlers';
import { oauthRepository } from '@/lib/mcp/server/oauth-repository';
import {
  publicOrigin,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
import { accountContext, type AccountEnvironment } from '@/lib/account/server';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as PublicMcpConfig &
    AccountEnvironment & { DB: D1Database };
  const account = accountContext(request, bindings);
  if (account instanceof Response) return account;
  return manageMcp(
    request,
    (await context.params).action,
    mcpRepository(bindings.DB),
    { repo: oauthRepository(bindings.DB), origin: publicOrigin(bindings) },
    account ?? undefined,
  );
}
export const POST = handle;
export const GET = handle;
