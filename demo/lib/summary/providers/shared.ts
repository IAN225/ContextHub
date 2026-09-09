import {
  SummaryError,
  MAX_SUMMARY_TEXT,
  type SummaryInput,
  type SummaryProtocol,
  type ThinkingEvidence,
} from '../contracts.ts';
export type ProviderRequest = {
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
};
export type ParsedSummary = {
  text: string;
  usage?: { input?: number; output?: number };
  thinkingEvidence?: ThinkingEvidence;
};
export type SummaryProvider = {
  id: SummaryProtocol;
  build: (input: SummaryInput, model: string, key: string) => ProviderRequest;
  parse: (body: unknown) => ParsedSummary;
};
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
export function string(value: unknown) {
  return typeof value === 'string' ? value : '';
}
export function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}
export function completed(reason: unknown, accepted: string[]) {
  if (!accepted.includes(string(reason)))
    throw new SummaryError(
      'INCOMPLETE_OUTPUT',
      '模型输出未正常完成，可能达到输出上限、拒绝或返回了工具调用。原摘要和水位未改动。',
      502,
    );
}
export function visibleText(text: string) {
  const clean = text
    .replace(/<(think|thinking|analysis)>[\s\S]*?<\/\1>/gi, '')
    .trim();
  if (/<(?:think|thinking|analysis)>/i.test(clean))
    throw new SummaryError(
      'INCOMPLETE_OUTPUT',
      '模型返回了未完成的思考片段，未作为摘要保存。',
      502,
    );
  if (!clean || clean.length > MAX_SUMMARY_TEXT)
    throw new SummaryError(
      'EMPTY_OUTPUT',
      '模型未返回可用摘要正文，或正文超过保存上限。',
      502,
    );
  return clean;
}
export function outputField(
  input: SummaryInput,
  fallback: string,
  supported: string[],
) {
  const value = input.config.outputField;
  const field = !value || value === '自动' ? fallback : value;
  if (!supported.includes(field))
    throw new SummaryError(
      'UNSUPPORTED_OUTPUT_FIELD',
      '最大输出字段与所选协议不匹配，请选择自动或该协议支持的字段。',
    );
  return field;
}
export function effort(value?: string) {
  if (!value || value === '未设置') return undefined;
  if (value === '开启') return 'medium';
  if (value === '关闭') return 'none';
  if (['low', 'medium', 'high'].includes(value)) return value;
  throw new SummaryError('UNSUPPORTED_THINKING', '不支持的思考设置。');
}
