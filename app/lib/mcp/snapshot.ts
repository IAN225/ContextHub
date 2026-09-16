import { attachmentContext } from '../attachments.ts';
import { type Note, type Workspace } from '../core/model.ts';
import type { WorkspaceSnapshotV2 } from '../storage/payload-v2.ts';
import { summaryTrack, summaryWorkspace } from '../summary/engines.ts';

// This local service copy is deliberately not an account/device sync format.
// Only memory inputs and Note history are exposed: no credentials or file bytes.
export function mcpWorkspace(w: Workspace): WorkspaceSnapshotV2 {
  return {
    memoryEngine: w.memoryEngine,
    ...(w.reme
      ? {
          reme: {
            ...summaryTrack(summaryWorkspace(w, 'reme')),
            config: { configured: false, auto: false, batch: 20, review: true },
          },
        }
      : {}),
    id: w.id,
    name: w.name,
    platform: w.platform,
    turns: w.turns.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      source: t.source,
      time: t.time,
      deletedAt: t.deletedAt,
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
      })),
    })),
    summaries: w.summaries.map(
      ({ id, title, text, covered, createdAt, generation }) => ({
        id,
        title,
        text,
        covered,
        createdAt,
        generation,
      }),
    ),
    activeId: w.activeId,
    watermark: w.watermark,
    retain: w.retain,
    retainMode: w.retainMode,
    retainTokens: w.retainTokens,
    notes: w.notes.map((n) => ({ ...n, versions: n.versions.slice(0, 5) })),
    blocks: w.blocks.map((b) => ({ ...b })),
    tokens: [],
    config: { configured: false, auto: false, batch: 20, review: true },
    started: w.started,
    firstComplete: w.firstComplete,
  };
}
export function noteSignature(n: Note | null | undefined) {
  if (!n) return 'null';
  return JSON.stringify({
    id: n.id,
    title: n.title,
    body: n.body,
    star: n.star,
    status: n.status,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    editor: n.editor,
    source: n.source,
    deletedAt: n.deletedAt,
  });
}
