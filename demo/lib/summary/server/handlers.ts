import {
  MAX_SUMMARY_BYTES,
  SummaryError,
  type GenerationConfig,
  type SummaryInput,
  type SummaryProbe,
} from '../contracts.ts';
import { object, outputField } from '../providers/shared.ts';
import {
  readSummaryConnection,
  summaryConnectionStatus,
  type SummaryEnvironment,
} from './config.ts';
import { generateSummary, readSummaryBody } from './service.ts';
import { thinkingProbe } from '../thinking-probe.ts';

const headers = { 'Cache-Control': 'no-store' };
function localRequest(request: Request) {
  const url = new URL(request.url),
    origin = request.headers.get('origin'),
    site = request.headers.get('sec-fetch-site');
  if (
    request.headers.get('x-context-hub') !== '1' ||
    (site && !['same-origin', 'none'].includes(site)) ||
    (origin && origin !== url.origin) ||
    (request.method !== 'GET' && !origin)
  )
    throw new SummaryError('FORBIDDEN', '请从当前 Context Hub 页面操作。', 403);
}
function inputFrom(value: unknown): SummaryInput {
  const body = object(value),
    raw = object(body.config);
  if (
    typeof body.system !== 'string' ||
    typeof body.user !== 'string' ||
    !body.user.trim()
  )
    throw new SummaryError(
      'INVALID_SUMMARY_INPUT',
      '摘要提示词为空或格式无效。',
    );
  const config: GenerationConfig = {};
  for (const key of [
    'model',
    'baseUrl',
    'protocol',
    'thinking',
    'outputField',
  ] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string')
      throw new SummaryError('INVALID_CONFIG', '摘要参数格式无效。');
    if (typeof raw[key] === 'string') config[key] = raw[key];
  }
  for (const key of ['budget', 'maxOutput'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'number')
      throw new SummaryError('INVALID_CONFIG', '摘要预算格式无效。');
    if (typeof raw[key] === 'number') config[key] = raw[key];
  }
  return { system: body.system, user: body.user, config };
}
type CachedRequest = {
  fingerprint: string;
  at: number;
  response: Promise<{ body: string; status: number }>;
};
function cachedResponse(value: { body: string; status: number }) {
  return new Response(value.body, {
    status: value.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
// Short-lived local idempotency prevents double clicks/retransmissions from
// charging twice. Nothing here is written to disk or sent to the model as an ID.
export function createSummaryHandler() {
  const cache = new Map<string, CachedRequest>();
  let busy = false;
  return async function handle(
    request: Request,
    action: string,
    env: SummaryEnvironment,
    fetcher?: typeof fetch,
  ): Promise<Response> {
    try {
      localRequest(request);
      if (action === 'connection' && request.method === 'GET')
        return Response.json(summaryConnectionStatus(env), { headers });
      if (!['generate', 'probe'].includes(action) || request.method !== 'POST')
        throw new SummaryError('NOT_FOUND', '未知摘要操作。', 404);
      if (!request.headers.get('content-type')?.includes('application/json'))
        throw new SummaryError('JSON_REQUIRED', '请使用 JSON 请求。', 415);
      const body = await readSummaryBody(
        request,
        MAX_SUMMARY_BYTES,
        AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
      );
      let decoded: unknown;
      try {
        decoded = JSON.parse(body);
      } catch {
        throw new SummaryError('INVALID_JSON', '摘要请求 JSON 无效。');
      }
      const input = inputFrom(decoded);
      const key = request.headers.get('idempotency-key') ?? '';
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key))
        throw new SummaryError(
          'REQUEST_ID_REQUIRED',
          '摘要请求缺少有效任务编号。',
        );
      const fingerprint = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`${action}\n${body}`),
          ),
        ),
        (x) => x.toString(16).padStart(2, '0'),
      ).join('');
      for (const [id, entry] of cache)
        if (Date.now() - entry.at > 300000) cache.delete(id);
      const existing = cache.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          throw new SummaryError(
            'REQUEST_CONFLICT',
            '任务编号对应了不同输入，请重新发起。',
            409,
          );
        return cachedResponse(await existing.response);
      }
      if (busy)
        throw new SummaryError(
          'SUMMARY_BUSY',
          '已有模型请求进行中，请等待完成或取消后再试。',
          409,
        );
      busy = true;
      const response = (async () => {
        try {
          const result = await generateSummary(
            input,
            env,
            request.signal,
            fetcher,
          );
          if (action !== 'probe') return Response.json(result, { headers });
          const { protocol, thinking } = readSummaryConnection(env);
          const fallback = {
            openai: 'max_completion_tokens',
            responses: 'max_output_tokens',
            anthropic: 'max_tokens',
            gemini: 'maxOutputTokens',
          }[protocol];
          const field = outputField(input, fallback, [
            'max_tokens',
            'max_completion_tokens',
            'max_output_tokens',
            'maxOutputTokens',
          ]);
          const probes: SummaryProbe[] = [
            {
              field,
              status: '字段被接受',
              detail: '本次请求成功并返回完整正文；不代表已验证最大输出上限。',
            },
          ];
          const effectiveThinking = thinking || input.config.thinking;
          if (effectiveThinking && effectiveThinking !== '未设置')
            probes.push(
              thinkingProbe(effectiveThinking, result.thinkingEvidence),
            );
          return Response.json(
            {
              probes,
              model: result.model,
              protocol: result.protocol,
              usage: result.usage,
            },
            { headers },
          );
        } catch (error) {
          return errorResponse(error);
        } finally {
          busy = false;
        }
      })().then(async (result) => ({
        body: await result.text(),
        status: result.status,
      }));
      if (cache.size >= 30) cache.delete(cache.keys().next().value!);
      cache.set(key, { fingerprint, at: Date.now(), response });
      return cachedResponse(await response);
    } catch (error) {
      // Drain rejected request bodies for local Wrangler's HTTP proxy reuse.
      if (!request.bodyUsed) {
        try {
          await readSummaryBody(
            request,
            8 * 1024 * 1024,
            AbortSignal.timeout(2000),
          );
        } catch {
          /* No body retained. */
        }
      }
      return errorResponse(error);
    }
  };
}
function errorResponse(error: unknown) {
  const known =
    error instanceof SummaryError
      ? error
      : new SummaryError(
          'SUMMARY_FAILED',
          '摘要服务未完成请求，请检查本地服务。',
          500,
        );
  return Response.json(
    { error: { code: known.code, message: known.message } },
    { status: known.status, headers },
  );
}
