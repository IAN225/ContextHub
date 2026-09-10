import type { BackgroundTask, TaskResult } from './contracts.ts';
export async function taskRequest<T>(
  action: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/tasks/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'x-context-hub': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const value = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok)
    throw new Error(value.error?.message || '后台任务服务不可用。');
  return value;
}
export const taskControl = (
  id: string,
  action: 'pause' | 'resume' | 'cancel',
) => taskRequest<{ task: BackgroundTask }>('control', { id, action });
export const taskResult = (id: string, step: number) =>
  taskRequest<{ result: TaskResult | null }>(
    `result?id=${encodeURIComponent(id)}&step=${step}`,
  );
