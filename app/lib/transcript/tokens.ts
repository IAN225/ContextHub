import { attachmentContext } from '../attachments.ts';
import { type Turn } from '../core/model.ts';
import { estimateTextTokens } from '../token-budget.ts';

export function estimateTurnTokens(turn: Turn) {
  return (
    turn.messages.reduce(
      (total, message) =>
        total +
        16 +
        estimateTextTokens(
          JSON.stringify({
            role: message.role,
            content: message.content,
            name: message.name,
            callId: message.callId,
          }),
        ),
      0,
    ) +
    (turn.attachments?.length
      ? estimateTextTokens(
          JSON.stringify(turn.attachments.map(attachmentContext)),
        )
      : 0)
  );
}
