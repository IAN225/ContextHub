import { groupTurns, type Message } from '../../domain.ts';
type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const row = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});
function textContent(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  return v
    .map((p) => {
      const b = row(p);
      if (['text', 'input_text', 'output_text'].includes(str(b.type)))
        return str(b.text ?? '');
      if (['image', 'image_url', 'input_image'].includes(str(b.type)))
        return '[图片引用：未下载素材，请另行补充]';
      if (['document', 'input_file', 'file'].includes(str(b.type)))
        return '[附件引用：未下载素材，请另行补充]';
      if (
        [
          'thinking',
          'redacted_thinking',
          'reasoning',
          'tool_result',
          'tool_use',
        ].includes(str(b.type))
      )
        return '';
      if (b.type === 'refusal') return str(b.refusal);
      return `[未支持的内容块：${str(b.type).slice(0, 60) || '未知格式'}，请另行补充]`;
    })
    .filter(Boolean)
    .join('\n');
}
export function parseRequestMessages(
  payload: unknown,
  protocol: string,
): Message[] {
  const p = row(payload),
    input = protocol === 'responses' ? p.input : p.messages;
  const items =
    typeof input === 'string'
      ? [{ role: 'user', content: input }]
      : Array.isArray(input)
        ? input
        : [];
  const messages: Message[] = [];
  for (const value of items) {
    const m = row(value),
      role = str(m.role ?? ''),
      type = str(m.type ?? '');
    if (type === 'reasoning' || type === 'thinking') continue;
    if (type === 'function_call') {
      messages.push({
        role: 'tool_call',
        name: str(m.name ?? ''),
        callId: str(m.call_id ?? ''),
        content: str(m.arguments ?? ''),
      });
      continue;
    }
    if (type === 'function_call_output') {
      messages.push({
        role: 'tool_result',
        callId: str(m.call_id ?? ''),
        content:
          typeof m.output === 'string'
            ? m.output
            : JSON.stringify(m.output ?? '[工具结果缺失]'),
      });
      continue;
    }
    if (!['user', 'assistant', 'tool'].includes(role)) continue;
    if (role === 'tool') {
      messages.push({
        role: 'tool_result',
        content: textContent(m.content),
        callId: str(m.tool_call_id ?? ''),
      });
      continue;
    }
    const blocks = Array.isArray(m.content) ? m.content : [];
    // Anthropic tool-result envelopes have role=user but are continuations, not new turns.
    const toolResults = blocks.map(row).filter((b) => b.type === 'tool_result');
    for (const b of toolResults)
      messages.push({
        role: 'tool_result',
        callId: str(b.tool_use_id ?? ''),
        content: textContent(b.content),
      });
    const content = textContent(m.content);
    if (role === 'assistant' && blocks.length) {
      for (const block of blocks) {
        const b = row(block);
        if (b.type === 'tool_use')
          messages.push({
            role: 'tool_call',
            name: str(b.name ?? ''),
            callId: str(b.id ?? ''),
            content: JSON.stringify(b.input ?? {}),
          });
        else {
          const text = textContent([block]);
          if (text) messages.push({ role, content: text });
        }
      }
    } else if (content || (role === 'user' && !toolResults.length))
      messages.push({ role, content });
    for (const b of (Array.isArray(m.tool_calls) ? m.tool_calls : []).map(
      row,
    )) {
      const fn = row(b.function);
      messages.push({
        role: 'tool_call',
        name: str(fn.name ?? ''),
        callId: str(b.id ?? ''),
        content: str(fn.arguments ?? ''),
      });
    }
  }
  return messages;
}
export function parseDelivery(payload: unknown, protocol: string) {
  const messages = parseRequestMessages(payload, protocol);
  const turns = groupTurns(messages, `投递请求 · ${protocol}`);
  if (!turns.length)
    throw new Error(
      '没有找到有效用户轮次。请提供包含 user 消息的完整请求 JSON。',
    );
  return turns;
}
