import type { WorkspaceSnapshotV1 } from '../storage/payload-v1.ts';
import type { Workspace } from '../domain.ts';
import { attachmentContext } from '../attachments.ts';

// The job needs summary inputs, never browser tokens, Note bodies or binary media.
export function summaryTaskWorkspace(w: Workspace): WorkspaceSnapshotV1 {
  return {
    id: w.id,
    name: w.name,
    platform: w.platform,
    summaries: w.summaries,
    activeId: w.activeId,
    watermark: w.watermark,
    retain: w.retain,
    retainMode: w.retainMode,
    retainTokens: w.retainTokens,
    config: w.config,
    started: w.started,
    firstComplete: w.firstComplete,
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
