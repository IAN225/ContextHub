import { type WorkspaceContext } from '../../core/model.ts';
import { readTextBody } from '../../server/body.ts';
import { digest } from '../../server/crypto.ts';
import { managementGuard } from '../../server/request.ts';
import {
  resolveSummaryConnection,
  type SummaryEnvironment,
} from '../../summary/server/config.ts';
import { MAX_TASK_BYTES, TaskError } from '../contracts.ts';
export type TaskEnvironment = SummaryEnvironment & {
  CONTEXT_HUB_TASK_RUNNER_KEY?: string;
};
export const headers = { 'Cache-Control': 'no-store' };
export const requireManagementRequest = managementGuard(
  (message) => new TaskError('FORBIDDEN', message, 403),
);
export const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export async function body(request: Request, limit = MAX_TASK_BYTES) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new TaskError('JSON_REQUIRED', '请使用 JSON 请求。', 415);
  try {
    return object(
      JSON.parse(
        await readTextBody(request, limit, {
          tooLarge: () =>
            new TaskError('TOO_LARGE', '内容超过大小限制，请分批导入。', 413),
        }),
      ),
    );
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    throw new TaskError('INVALID_JSON', '任务数据格式无效。');
  }
}
export async function connectionHash(
  w: WorkspaceContext,
  env: TaskEnvironment,
) {
  const c = resolveSummaryConnection(w.config, env);
  return digest(JSON.stringify(c));
}
export function runtimeReady(env: TaskEnvironment) {
  return Boolean(env.CONTEXT_HUB_TASK_RUNNER_KEY);
}
export async function requireRunner(request: Request, env: TaskEnvironment) {
  const key = request.headers.get('x-context-hub-runner') ?? '';
  if (
    !env.CONTEXT_HUB_TASK_RUNNER_KEY ||
    !key ||
    (await digest(key)) !== (await digest(env.CONTEXT_HUB_TASK_RUNNER_KEY))
  )
    throw new TaskError('FORBIDDEN', '任务执行器未授权。', 403);
}
