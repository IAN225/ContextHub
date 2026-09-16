import { type Workspace } from '../../core/model.ts';
import { digest } from '../../imports/server/auth.ts';
import { readLimitedBody } from '../../imports/server/share-service.ts';
import {
  resolveSummaryConnection,
  type SummaryEnvironment,
} from '../../summary/server/config.ts';
import { MAX_TASK_BYTES, TaskError } from '../contracts.ts';
import type { TaskRepository } from './repository.ts';
export type TaskEnvironment = SummaryEnvironment & {
  CONTEXT_HUB_TASK_RUNNER_KEY?: string;
};
export const headers = { 'Cache-Control': 'no-store' };
export const COOKIE = 'context_hub_tasks';
export const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export async function body(request: Request, limit = MAX_TASK_BYTES) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new TaskError('JSON_REQUIRED', '请使用 JSON 请求。', 415);
  try {
    return object(JSON.parse(await readLimitedBody(request, limit)));
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    throw new TaskError('INVALID_JSON', '任务数据格式无效。');
  }
}
export async function owner(request: Request, repo: TaskRepository) {
  const secret = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return secret && /^[a-f0-9]{64}$/.test(secret)
    ? repo.session(await digest(secret))
    : undefined;
}
export async function connectionHash(w: Workspace, env: TaskEnvironment) {
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
