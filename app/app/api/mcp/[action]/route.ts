import { accountContext, type AccountEnvironment } from '@/lib/account/server';
import { applicationDatabase, env } from '@/lib/application/server/runtime';
import { workspaceApplication } from '@/lib/application/server/workspaces';
import { manageMcp } from '@/lib/mcp/server/management';
import { oauthRepository } from '@/lib/mcp/server/oauth-repository';
import {
  publicOrigin,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
import { mcpRepository } from '@/lib/mcp/server/repository';
import type { SqlDatabase } from '@/lib/server/database';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as PublicMcpConfig &
    AccountEnvironment & { DB: SqlDatabase };
  const account = accountContext(request, bindings);
  if (account instanceof Response) return account;
  return manageMcp(
    request,
    (await context.params).action,
    mcpRepository(bindings.DB, workspaceApplication(applicationDatabase())),
    { repo: oauthRepository(bindings.DB), origin: publicOrigin(bindings) },
    account ?? undefined,
  );
}
export const POST = handle;
export const GET = handle;
