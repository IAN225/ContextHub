import { SummaryError, type SummaryProtocol } from '../contracts.ts';
import { openaiSummary, responsesSummary } from './openai.ts';
import { anthropicSummary } from './anthropic.ts';
import { geminiSummary } from './gemini.ts';
import type { SummaryProvider } from './shared.ts';
const providers: Record<SummaryProtocol, SummaryProvider> = {
  openai: openaiSummary,
  responses: responsesSummary,
  anthropic: anthropicSummary,
  gemini: geminiSummary,
};
export function summaryProvider(id: string) {
  if (!Object.hasOwn(providers, id))
    throw new SummaryError(
      'UNSUPPORTED_PROTOCOL',
      '摘要协议应为 openai、responses、anthropic 或 gemini。',
    );
  return providers[id as SummaryProtocol];
}
