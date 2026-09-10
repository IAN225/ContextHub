import type { Config } from '../domain.ts';
import { estimateTextTokens } from '../token-budget.ts';

export type SummaryProtocol = 'openai' | 'responses' | 'anthropic' | 'gemini';
export type GenerationConfig = Pick<
  Config,
  | 'model'
  | 'baseUrl'
  | 'protocol'
  | 'budget'
  | 'maxOutput'
  | 'thinking'
  | 'outputField'
>;
export type SummaryInput = {
  system: string;
  user: string;
  config: GenerationConfig;
};
export type SummaryResult = {
  text: string;
  model: string;
  protocol: SummaryProtocol;
  usage?: { input?: number; output?: number };
  thinkingEvidence?: ThinkingEvidence;
};
export type ThinkingEvidence = {
  tokens?: number;
  hasOutput: boolean;
};
export type SummaryConnection = {
  keyConfigured?: boolean;
  editable?: boolean;
  revision?: string;
  source?: 'local' | 'environment';
  ready: boolean;
  baseUrl: string;
  model: string;
  protocol: SummaryProtocol;
  thinking?: string;
  message: string;
};
export type SummaryConnectionInput = {
  baseUrl: string;
  model: string;
  protocol: string;
  apiKey: string;
  revision: string;
};
export type SummaryProbe = {
  field: string;
  status:
    | '字段被接受'
    | '明确报错'
    | '无法确认是否生效'
    | '已观察到思考'
    | '本次未产生思考'
    | '与设置不符';
  detail: string;
};
export class SummaryError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'SummaryError';
    this.code = code;
    this.status = status;
  }
}
export const MAX_SUMMARY_BYTES = 2 * 1024 * 1024;
export const MAX_SUMMARY_TEXT = 256 * 1024;
export function generationConfig(config: Config): GenerationConfig {
  const { model, baseUrl, protocol, budget, maxOutput, thinking, outputField } =
    config;
  return { model, baseUrl, protocol, budget, maxOutput, thinking, outputField };
}
export function outputBudget(config: GenerationConfig) {
  const value = config.maxOutput ?? 4000;
  if (!Number.isInteger(value) || value < 256 || value > 64000)
    throw new SummaryError(
      'INVALID_BUDGET',
      '最大输出需要是 256–64000 之间的整数。',
    );
  return value;
}
export function inputBudget(config: GenerationConfig) {
  const value = config.budget ?? 32000;
  if (!Number.isInteger(value) || value < 2048 || value > 2000000)
    throw new SummaryError(
      'INVALID_BUDGET',
      '上下文预算需要是 2048–2000000 之间的整数。',
    );
  return value;
}
// UTF-8 bytes are a deliberately conservative token estimate for arbitrary
// compatible providers. Do not reuse imported token counters for composed prompts.
export function estimateInput(system: string, user: string) {
  return estimateTextTokens(system) + estimateTextTokens(user) + 128;
}
export function fitsBudget(input: SummaryInput) {
  const budget = inputBudget(input.config);
  return (
    estimateInput(input.system, input.user) +
      outputBudget(input.config) +
      Math.max(512, Math.ceil(budget * 0.1)) <=
    budget
  );
}
