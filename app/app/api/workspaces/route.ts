import { accountContext } from '@/lib/account/server';
import type { CommandRequest } from '@/lib/application/contracts';
import { applicationDatabase, env } from '@/lib/application/server/runtime';
import {
  ApplicationError,
  workspaceApplication,
} from '@/lib/application/server/workspaces';
import { discardRequestBody, readTextBody } from '@/lib/server/body';
export async function GET(request: Request) {
  const owner = accountContext(request, env);
  if (owner instanceof Response) return owner;
  if (!owner) return Response.json({ error: '请先登录。' }, { status: 401 });
  try {
    const app = workspaceApplication(applicationDatabase());
    return app.transaction(() => {
      const etag = app.revision(owner),
        headers = { 'Cache-Control': 'private, no-cache', ETag: etag };
      if (request.headers.get('if-none-match') === etag)
        return new Response(null, { status: 304, headers });
      return Response.json(app.read(owner), { headers });
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const owner = accountContext(request, env);
    if (owner instanceof Response) return owner;
    if (!owner) return Response.json({ error: '请先登录。' }, { status: 401 });
    if (request.headers.get('x-context-hub') !== '1')
      return Response.json({ error: '请求来源无效。' }, { status: 403 });
    const input = JSON.parse(
      await readTextBody(request, 32 * 1024 * 1024, {
        tooLarge: () => new ApplicationError('BODY_LIMIT', '请求过大。', 413),
      }),
    );
    return Response.json(
      workspaceApplication(applicationDatabase()).execute(
        owner,
        input as CommandRequest,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failure(error);
  } finally {
    await discardRequestBody(request);
  }
}
function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : '操作失败。' },
    { status: error instanceof ApplicationError ? error.status : 400 },
  );
}
