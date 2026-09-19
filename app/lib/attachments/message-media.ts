import { attachmentMarker } from './content.ts';
import { type Turn } from '../core/model.ts';
/** Projection only: original imported text and payload remain untouched. */
export function messageMedia(turn: Turn) {
  const attachments = turn.attachments ?? [];
  const byMessage = turn.messages.map(() => [] as typeof attachments);
  const unassigned: typeof attachments = [];
  for (const attachment of attachments) {
    let owners = turn.messages.flatMap((m, i) =>
      m.attachmentIds?.includes(attachment.id) ? [i] : [],
    );
    if (!owners.length)
      owners = turn.messages.flatMap((m, i) =>
        m.content.includes(attachmentMarker(attachment)) ? [i] : [],
      );
    if (owners.length === 1) byMessage[owners[0]].push(attachment);
    else unassigned.push(attachment);
  }
  const messages = turn.messages.map((m, i) => ({
    ...m,
    content: byMessage[i]
      .reduce((text, a) => text.split(attachmentMarker(a)).join(''), m.content)
      .trim(),
  }));
  return { messages, byMessage, unassigned };
}
