import type { Protocol } from '../contracts.ts';

const headers = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'X-Context-Hub-Receipt',
};
export function deliveryAcknowledgement(
  protocol: Protocol,
  id: string,
  model: string,
  stream: boolean,
) {
  const text =
    '对话上下文已收到，请回到 Context Hub 收件箱确认归档。此接口只负责收录，不生成模型回答。';
  const created = Math.floor(Date.now() / 1000);
  if (protocol === 'chat') {
    const base = { id: `chatcmpl-${id}`, created, model };
    if (!stream)
      return Response.json(
        {
          ...base,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: text },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
        { headers },
      );
    return sse([
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: text },
            finish_reason: null,
          },
        ],
      },
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
      '[DONE]',
    ]);
  }
  if (protocol === 'messages') {
    const message = {
      id: `msg_${id}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
    if (!stream) return Response.json(message, { headers });
    return sse(
      [
        {
          type: 'message_start',
          message: { ...message, content: [], stop_reason: null },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 0 },
        },
        { type: 'message_stop' },
      ],
      true,
    );
  }
  const item = {
    id: `msg_${id}`,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  };
  const response = {
    id: `resp_${id}`,
    object: 'response',
    created_at: created,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model,
    output: [item],
    parallel_tool_calls: false,
    tools: [],
    tool_choice: 'auto',
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  };
  if (!stream) return Response.json(response, { headers });
  const events = [
    {
      type: 'response.created',
      response: { ...response, status: 'in_progress', output: [] },
    },
    {
      type: 'response.in_progress',
      response: { ...response, status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, status: 'in_progress', content: [] },
    },
    {
      type: 'response.content_part.added',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '', annotations: [] },
    },
    {
      type: 'response.output_text.delta',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: [],
    },
    {
      type: 'response.output_text.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text,
      logprobs: [],
    },
    {
      type: 'response.content_part.done',
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: item.content[0],
    },
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response },
  ];
  return sse(
    events.map((event, sequence_number) => ({ ...event, sequence_number })),
    true,
  );
}
function sse(events: (Record<string, unknown> | string)[], named = false) {
  const body = events
    .map(
      (e) =>
        `${named && typeof e !== 'string' ? `event: ${String(e.type)}\n` : ''}data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`,
    )
    .join('');
  return new Response(body, {
    headers: { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}
