import { env } from 'cloudflare:workers';
import { taskRepository } from '@/lib/tasks/server/repository';
import { taskHandler, type TaskEnvironment } from '@/lib/tasks/server/handlers';
import { summarySettingsRepository } from '@/lib/summary/server/settings';
async function handle(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const bindings = env as unknown as TaskEnvironment & { DB: D1Database };
  const action = (await context.params).action;
  const connection =
    action === 'runner-summary' || action === 'enqueue'
      ? (await summarySettingsRepository(bindings.DB).read(bindings)).env
      : {};
  return taskHandler(request, action, taskRepository(bindings.DB), {
    ...bindings,
    ...connection,
  });
}
export const GET = handle;
export const POST = handle;
