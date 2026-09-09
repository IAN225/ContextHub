import { importResponse, manageImports } from '@/lib/imports/server/handlers';
import { importRepository } from '@/lib/imports/server/runtime';

async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return importResponse(
    async () =>
      manageImports(request, (await context.params).action, importRepository()),
    false,
    request,
  );
}
export const GET = handle;
export const POST = handle;
