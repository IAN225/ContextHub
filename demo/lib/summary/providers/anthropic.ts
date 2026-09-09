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

export const anthropicSummary: SummaryProvider = {
  id: 'anthropic',
  build(input, model, key) {
    outputField(input, 'max_tokens', ['max_tokens']);
    const setting = input.config.thinking;
    let thinking: Record<string, unknown> | undefined;
    let output_config: Record<string, unknown> | undefined;
    if (setting === '关闭') thinking = { type: 'disabled' };
    else if (setting === '开启') {
      if (outputBudget(input.config) <= 1024)
        throw new SummaryError(
          'THINKING_BUDGET',
          '开启 Anthropic 思考时，最大输出必须大于 1024 token。',
        );
      thinking = { type: 'enabled', budget_tokens: 1024 };
    } else if (setting && ['low', 'medium', 'high'].includes(setting)) {
      thinking = { type: 'adaptive' };
      output_config = { effort: setting };
    } else if (setting && setting !== '未设置')
      throw new SummaryError('UNSUPPORTED_THINKING', '不支持的思考设置。');
    return {
      path: '/messages',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: {
        model,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
        max_tokens: outputBudget(input.config),
        stream: false,
        ...(thinking ? { thinking } : {}),
        ...(output_config ? { output_config } : {}),
      },
    };
  },
  parse(value) {
    const data = object(value);
    completed(data.stop_reason, ['end_turn']);
    if (object(data.stop_details).type === 'refusal')
      completed('refusal', ['end_turn']);
    const parts: string[] = [];
    for (const raw of array(data.content)) {
      const block = object(raw);
      if (block.type === 'thinking' || block.type === 'redacted_thinking')
        continue;
      if (block.type !== 'text') completed('unexpected_block', ['text']);
      parts.push(string(block.text));
    }
    const usage = object(data.usage);
    return {
      text: visibleText(parts.join('\n')),
      usage: {
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
      },
    };
  },
};
