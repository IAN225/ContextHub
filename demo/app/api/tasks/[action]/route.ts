import { env } from 'cloudflare:workers';
import { taskRepository } from '@/lib/tasks/server/repository';
import { taskHandler, type TaskEnvironment } from '@/lib/tasks/server/handlers';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as unknown as TaskEnvironment & { DB: D1Database };
  return taskHandler(
    request,
    (await context.params).action,
    taskRepository(bindings.DB),
    bindings,
  );
}
export const GET = handle;
export const POST = handle;
