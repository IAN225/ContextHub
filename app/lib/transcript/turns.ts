import { uid } from '../core/identity.ts';
import { type Message, type Turn } from '../core/model.ts';

export function groupTurns(messages: Message[], source = '文本粘贴'): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (
      !['user', 'assistant', 'tool', 'tool_call', 'tool_result'].includes(
        m.role,
      )
    )
      continue;
    if (m.role === 'user')
      turns.push({
        id: uid(),
        title: m.content.slice(0, 36) || '附件对话',
        messages: [],
        status: 'normal',
        source,
        time: null,
      });
    if (turns.length) {
      const media = m.attachments ?? [];
      if (media.length) {
        const turn = turns[turns.length - 1];
        turn.attachments = [...(turn.attachments ?? []), ...media];
      }
      turns[turns.length - 1].messages.push({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.callId ? { callId: m.callId } : {}),
        ...(media.length || m.attachmentIds?.length
          ? {
              attachmentIds: [
                ...new Set([
                  ...(m.attachmentIds ?? []),
                  ...media.map((a) => a.id),
                ]),
              ],
            }
          : {}),
      });
    }
  }
  return turns;
}
