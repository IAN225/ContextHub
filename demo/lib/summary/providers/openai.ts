import { outputBudget } from '../contracts.ts';
import {
  array,
  completed,
  count,
  effort,
  object,
  outputField,
  string,
  visibleText,
  type SummaryProvider,
} from './shared.ts';

export const openaiSummary: SummaryProvider = {
  id: 'openai',
  build(input, model, key) {
    const field = outputField(input, 'max_completion_tokens', [
      'max_tokens',
      'max_completion_tokens',
    ]);
    const reasoning = effort(input.config.thinking);
    return {
      path: '/chat/completions',
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        stream: false,
        [field]: outputBudget(input.config),
        ...(reasoning ? { reasoning_effort: reasoning } : {}),
      },
    };
  },
  parse(value) {
    const data = object(value),
      choice = object(array(data.choices)[0]),
      message = object(choice.message);
    completed(choice.finish_reason, ['stop']);
    if (
      message.refusal ||
      array(message.tool_calls).length ||
      message.function_call
    )
      completed('refusal', ['stop']);
    const usage = object(data.usage);
    return {
      text: visibleText(string(message.content)),
      usage: {
        input: count(usage.prompt_tokens),
        output: count(usage.completion_tokens),
      },
    };
  },
};
export const responsesSummary: SummaryProvider = {
  id: 'responses',
  build(input, model, key) {
    outputField(input, 'max_output_tokens', ['max_output_tokens']);
    const reasoning = effort(input.config.thinking);
    return {
      path: '/responses',
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model,
        instructions: input.system,
        input: [{ role: 'user', content: input.user }],
        stream: false,
        store: false,
        max_output_tokens: outputBudget(input.config),
        ...(reasoning ? { reasoning: { effort: reasoning } } : {}),
      },
    };
  },
  parse(value) {
    const data = object(value);
    completed(data.status, ['completed']);
    if (data.error || data.incomplete_details)
      completed('incomplete', ['completed']);
    const parts: string[] = [];
    let hasThinkingOutput = false;
    for (const output of array(data.output)) {
      const item = object(output);
      if (item.type === 'reasoning') {
        // Keep only evidence that output exists, never the thinking text itself.
        hasThinkingOutput ||=
          Boolean(string(item.encrypted_content).trim()) ||
          [...array(item.content), ...array(item.summary)].some((part) =>
            Boolean(string(object(part).text).trim()),
          );
        continue;
      }
      if (item.type !== 'message' || item.role !== 'assistant')
        completed('unexpected_item', ['message']);
      completed(item.status, ['completed']);
      for (const raw of array(item.content)) {
        const content = object(raw);
        if (content.type !== 'output_text')
          completed('unexpected_content', ['output_text']);
        parts.push(string(content.text));
      }
    }
    const usage = object(data.usage);
    const thinkingTokens = count(
      object(usage.output_tokens_details).reasoning_tokens,
    );
    return {
      text: visibleText(parts.join('\n')),
      thinkingEvidence: {
        tokens:
          thinkingTokens !== undefined && Number.isInteger(thinkingTokens)
            ? thinkingTokens
            : undefined,
        hasOutput: hasThinkingOutput,
      },
      usage: {
        input: count(usage.input_tokens),
        output: count(usage.output_tokens),
      },
    };
  },
};
