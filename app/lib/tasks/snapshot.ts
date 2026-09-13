import type { Workspace } from '../domain.ts';
import { attachmentContext } from '../attachments.ts';

// The job needs summary inputs, never browser tokens, Note bodies or binary media.
export function summaryTaskWorkspace(w: Workspace): Workspace {
  return {
    ...w,
    tokens: [],
    blocks: [],
    turns: w.turns.map((t) => ({
      ...t,
      messages: t.messages.map(
        ({ role, content, name, callId, attachmentIds }) => ({
          role,
          content,
          name,
          callId,
          attachmentIds,
        }),
      ),
      attachments: t.attachments?.map((a) => ({
        ...attachmentContext(a),
        url: '',
        text: a.text,
        status:
          a.status ??
          (a.url.startsWith('data:')
            ? 'stored'
            : /^https:\/\//i.test(a.url)
              ? 'remote'
              : 'missing'),
      })),
    })),
    notes: w.notes.map((n) => ({ ...n, body: '', versions: [] })),
  };
}
