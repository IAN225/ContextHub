import {
  SummaryError,
  type GenerationConfig,
  type SummaryConnection,
  type SummaryProtocol,
} from '../contracts.ts';
import { summaryProvider } from '../providers/index.ts';

export type SummaryEnvironment = {
  CONTEXT_HUB_SUMMARY_BASE_URL?: string;
  CONTEXT_HUB_SUMMARY_MODEL?: string;
  CONTEXT_HUB_SUMMARY_API_KEY?: string;
  CONTEXT_HUB_SUMMARY_PROTOCOL?: string;
};
export function normalizeBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SummaryError(
      'INVALID_BASE_URL',
      '本地摘要配置中的 Base URL 无效。',
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['https:', 'http:'].includes(url.protocol) ||
    (url.protocol === 'http:' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new SummaryError(
      'INVALID_BASE_URL',
      'Base URL 请使用 HTTPS；本机模型可用 localhost / 127.0.0.1 的 HTTP。地址不能包含凭据、查询参数或片段。',
    );
  return url.href.replace(/\/+$/, '');
}
export function readSummaryConnection(env: SummaryEnvironment) {
  const baseUrl = env.CONTEXT_HUB_SUMMARY_BASE_URL?.trim() ?? '';
  const model = env.CONTEXT_HUB_SUMMARY_MODEL?.trim() ?? '';
  const apiKey = env.CONTEXT_HUB_SUMMARY_API_KEY?.trim() ?? '';
  const protocol = env.CONTEXT_HUB_SUMMARY_PROTOCOL?.trim() || 'openai';
  if (!baseUrl || !model || !apiKey)
    throw new SummaryError(
      'SUMMARY_NOT_READY',
      '请填写本地摘要接口配置文件并重启服务，再连接模型。',
      503,
    );
  if (model.length > 200 || /[\r\n]/.test(model) || /[\r\n]/.test(apiKey))
    throw new SummaryError(
      'INVALID_MODEL_CONFIG',
      '本地模型名称或凭据格式无效。',
    );
  const provider = summaryProvider(protocol);
  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    model,
    apiKey,
    protocol: provider.id,
  };
}
export function summaryConnectionStatus(
  env: SummaryEnvironment,
): SummaryConnection {
  try {
    const { baseUrl, model, protocol } = readSummaryConnection(env);
    return {
      ready: true,
      baseUrl,
      model,
      protocol,
      message: '本地凭据已配置，尚需实际请求验证连接。',
    };
  } catch (error) {
    return {
      ready: false,
      baseUrl: '',
      model: '',
      protocol: 'openai',
      message:
        error instanceof SummaryError
          ? error.message
          : '本地摘要配置无法读取。',
    };
  }
}
export function resolveSummaryConnection(
  config: GenerationConfig,
  env: SummaryEnvironment,
) {
  const connection = readSummaryConnection(env);
  // A browser may never redirect the server-held key to a different address.
  if (config.baseUrl && normalizeBaseUrl(config.baseUrl) !== connection.baseUrl)
    throw new SummaryError(
      'CONNECTION_MISMATCH',
      '页面地址与本地凭据绑定的地址不同，请在摘要设置中使用本地连接。',
    );
  if (config.protocol && config.protocol !== connection.protocol)
    throw new SummaryError(
      'CONNECTION_MISMATCH',
      '页面协议与本地连接不同，请在摘要设置中使用本地连接。',
    );
  const model = config.model?.trim() || connection.model;
  if (model.length > 200 || /[\r\n]/.test(model))
    throw new SummaryError('INVALID_MODEL', '模型名称无效。');
  return {
    ...connection,
    model,
    protocol: connection.protocol as SummaryProtocol,
  };
}
