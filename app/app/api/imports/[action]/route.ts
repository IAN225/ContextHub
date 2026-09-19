import { accountContext, type AccountEnvironment } from '@/lib/account/server';
import { env } from '@/lib/application/server/runtime';
import { importResponse, manageImports } from '@/lib/imports/server/handlers';
import { importRepository } from '@/lib/imports/server/runtime';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const account = accountContext(request, env as AccountEnvironment);
  if (account instanceof Response) return account;
  return importResponse(
    async () =>
      manageImports(
        request,
        (await context.params).action,
        importRepository(),
        undefined,
        account ?? undefined,
      ),
    false,
    request,
  );
}
export const GET = handle;
export const POST = handle;
