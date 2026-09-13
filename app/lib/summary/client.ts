import { uid } from '../domain.ts';
import {
  SummaryError,
  type SummaryInput,
  type SummaryResult,
  type SummaryConnectionInput,
} from './contracts.ts';

export async function summaryRequest<T>(
  action: string,
  input?: SummaryInput | SummaryConnectionInput,
  signal?: AbortSignal,
  requestId = uid(),
): Promise<T> {
  const response = await fetch(`/api/summary/${action}`, {
    method: input ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      'X-Context-Hub': '1',
      ...(input
        ? { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }
        : {}),
    },
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new SummaryError(
      'INVALID_LOCAL_RESPONSE',
      '摘要服务未返回有效结果，请检查本地服务。',
      502,
    );
  }
  if (!response.ok) {
    const error = (result as { error?: { code?: string; message?: string } })
      ?.error;
    throw new SummaryError(
      error?.code || 'SUMMARY_FAILED',
      error?.message || '摘要请求失败。',
      response.status,
    );
  }
  return result as T;
}
export const requestSummary = (
  input: SummaryInput,
  signal?: AbortSignal,
  requestId?: string,
) => summaryRequest<SummaryResult>('generate', input, signal, requestId);
