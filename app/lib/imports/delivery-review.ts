import { type Upload } from '../core/model.ts';
import { uploadChannel } from './queue.ts';

// A chat client sends a new user message to trigger delivery. Keep the original
// receipt intact and let the reviewer opt back in before archiving it.
export function deliveryTriggerTurn(upload: Upload) {
  if (upload.kind !== 'conversation' || uploadChannel(upload) !== 'api')
    return undefined;
  const last = upload.turns.at(-1);
  if (
    last?.messages.length === 1 &&
    last.messages[0].role === 'user' &&
    !last.attachments?.length &&
    !last.messages[0].attachmentIds?.length
  )
    return last;
  return undefined;
}
