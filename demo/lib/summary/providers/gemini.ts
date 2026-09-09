import { outputBudget, SummaryError } from '../contracts.ts';
import {
  array,
  completed,
  count,
  object,
  outputField,
  string,
  visibleText,
  type SummaryProvider,
} from './shared.ts';

export const geminiSummary: SummaryProvider = {
  id: 'gemini',
  build(input, model, key) {
    outputField(input, 'maxOutputTokens', ['maxOutputTokens']);
    const setting = input.config.thinking;
    let thinkingConfig: Record<string, unknown> | undefined;
    if (setting === '关闭')
      thinkingConfig = { thinkingBudget: 0, includeThoughts: false };
    else if (setting === '开启')
      thinkingConfig = { thinkingBudget: -1, includeThoughts: false };
    else if (setting && ['low', 'medium', 'high'].includes(setting))
      thinkingConfig = {
        thinkingLevel: setting.toUpperCase(),
        includeThoughts: false,
      };
    else if (setting && setting !== '未设置')
      throw new SummaryError('UNSUPPORTED_THINKING', '不支持的思考设置。');
    return {
      path: `/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: 'user', parts: [{ text: input.user }] }],
        generationConfig: {
          maxOutputTokens: outputBudget(input.config),
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      },
    };
  },
  parse(value) {
    const data = object(value),
      candidate = object(array(data.candidates)[0]);
    if (object(data.promptFeedback).blockReason) completed('blocked', ['STOP']);
    completed(candidate.finishReason, ['STOP']);
    const parts: string[] = [];
    for (const raw of array(object(candidate.content).parts)) {
      const part = object(raw);
      if (part.thought === true) continue;
      if (typeof part.text !== 'string') completed('unexpected_part', ['text']);
      parts.push(string(part.text));
    }
    const usage = object(data.usageMetadata);
    return {
      text: visibleText(parts.join('\n')),
      usage: {
        input: count(usage.promptTokenCount),
        output: count(usage.candidatesTokenCount),
      },
    };
  },
};
