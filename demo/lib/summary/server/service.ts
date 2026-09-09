import {
  fitsBudget,
  MAX_SUMMARY_BYTES,
  SummaryError,
  type SummaryInput,
  type SummaryResult,
} from '../contracts.ts';
import { summaryProvider } from '../providers/index.ts';
import { resolveSummaryConnection, type SummaryEnvironment } from './config.ts';

export async function readSummaryBody(
  response: Response | Request,
  limit: number,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    throw new SummaryError('SUMMARY_ABORTED', '摘要请求已取消或超时。', 408);
  if (Number(response.headers.get('content-length')) > limit)
    throw new SummaryError(
      'SUMMARY_TOO_LARGE',
      '摘要请求或响应超过大小限制。',
      413,
    );
  const reader = response.body?.getReader();
  if (!reader) return '';
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => {
      void reader.cancel().catch(() => {});
      reject(
        new SummaryError('SUMMARY_ABORTED', '摘要请求已取消或超时。', 408),
      );
    };
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit)
        throw new SummaryError(
          'SUMMARY_TOO_LARGE',
          '摘要请求或响应超过大小限制。',
          413,
        );
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}
function providerFailure(status: number) {
  if (status === 401 || status === 403)
    return new SummaryError(
      'MODEL_AUTH_FAILED',
      '模型接口拒绝授权，请检查本地 Key 和模型访问权限。',
      502,
    );
  if (status === 429)
    return new SummaryError(
      'MODEL_RATE_LIMIT',
      '模型接口限流或额度不足，已暂停；请稍后手动重试。',
      429,
    );
  if (status === 404)
    return new SummaryError(
      'MODEL_NOT_FOUND',
      '模型或接口路径不存在，请检查 Base URL、协议和模型名。',
      502,
    );
  if (status === 400 || status === 422)
    return new SummaryError(
      'MODEL_PARAMETERS_REJECTED',
      '模型接口拒绝请求参数。请检查最大输出字段、思考设置和上下文预算；不会自动更换参数重试。',
      502,
    );
  return new SummaryError(
    'MODEL_REQUEST_FAILED',
    `模型接口请求失败（HTTP ${status}），已暂停。`,
    502,
  );
}
export async function generateSummary(
  input: SummaryInput,
  env: SummaryEnvironment,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SummaryResult> {
  const connection = resolveSummaryConnection(input.config, env);
  if (!fitsBudget(input))
    throw new SummaryError(
      'SUMMARY_OVER_BUDGET',
      '本次提示词与输出预留超出上下文预算。',
    );
  const provider = summaryProvider(connection.protocol);
  const effectiveInput = connection.thinking
    ? { ...input, config: { ...input.config, thinking: connection.thinking } }
    : input;
  const request = provider.build(
    effectiveInput,
    connection.model,
    connection.apiKey,
  );
  const body = JSON.stringify(request.body);
  if (new TextEncoder().encode(body).length > MAX_SUMMARY_BYTES)
    throw new SummaryError(
      'SUMMARY_TOO_LARGE',
      '本次模型请求过大，请缩小批次。',
      413,
    );
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 120000);
  try {
    controller.signal.throwIfAborted();
    const response = await fetcher(`${connection.baseUrl}${request.path}`, {
      method: 'POST',
      // Workers supports manual/follow; manual keeps credentials at the bound
      // endpoint, and the !ok check below rejects every redirect response.
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', ...request.headers },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw providerFailure(response.status);
    }
    const text = await readSummaryBody(
      response,
      MAX_SUMMARY_BYTES,
      controller.signal,
    );
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new SummaryError(
        'INVALID_MODEL_RESPONSE',
        '模型接口未返回有效 JSON，请检查请求协议。',
        502,
      );
    }
    const parsed = provider.parse(json);
    if (parsed.text.includes(connection.apiKey))
      throw new SummaryError(
        'INVALID_MODEL_RESPONSE',
        '模型响应包含不应出现在摘要中的连接数据，已拒绝保存。',
        502,
      );
    return { ...parsed, model: connection.model, protocol: provider.id };
  } catch (error) {
    if (controller.signal.aborted)
      throw new SummaryError(
        signal?.aborted ? 'SUMMARY_CANCELLED' : 'SUMMARY_TIMEOUT',
        signal?.aborted
          ? '本次摘要请求已取消。'
          : '模型响应超过两分钟，已暂停；请检查接口后手动重试。',
        408,
      );
    if (error instanceof SummaryError) throw error;
    // Never echo fetch errors or provider response bodies: either may contain
    // request URLs, authorization headers, prompts or hidden reasoning.
    throw new SummaryError(
      'MODEL_UNREACHABLE',
      '无法连接模型接口，已暂停；请检查网络和本地接口地址。',
      502,
    );
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener('abort', abort);
  }
}
