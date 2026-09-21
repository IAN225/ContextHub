import type { Summary, Workspace } from '../../core/model.ts';
import { coverage } from '../../summary/coverage.ts';
import { clientSummaryState } from '../../summary/client-compression.ts';
import { summaryWorkspace, type SummaryEngine } from '../../summary/engines.ts';
import { digest } from '../../server/crypto.ts';
import type {
  TranscriptRange,
  transcriptTurns,
} from '../../transcript/range.ts';
export const sourceResult = (source: TranscriptRange) => ({
  from_turn: source.from,
  to_turn: source.to,
  revision: source.revision,
});
export const summaryResult = (s: Summary | null | undefined) =>
  s
    ? {
        id: s.id,
        title: s.title,
        text: s.text,
        covered_turn_ids: s.covered,
        created_at: s.createdAt,
        ...(s.generation ? { generation: s.generation } : {}),
      }
    : null;
export function turnResult(
  t: ReturnType<typeof transcriptTurns> extends Generator<infer T> ? T : never,
) {
  return {
    ...t,
    messages: t.messages.map(({ callId, attachmentIds, ...m }) => ({
      ...m,
      ...(callId === undefined ? {} : { call_id: callId }),
      ...(attachmentIds === undefined ? {} : { attachment_ids: attachmentIds }),
    })),
  };
}
export async function summaryState(w: Workspace, engine: SummaryEngine) {
  const scoped = summaryWorkspace(w, engine);
  const active = scoped.summaries.find((s) => s.id === scoped.activeId) ?? null;
  const revision =
    engine === 'client'
      ? clientSummaryState(w).revision
      : await digest(
          JSON.stringify([engine, scoped.activeId, scoped.watermark, active]),
        );
  const firstRecent = coverage(scoped).recent[0];
  return {
    revision,
    active,
    total_turns: w.turns.length,
    recent_from_turn: firstRecent
      ? w.turns.findIndex((t) => t.id === firstRecent.id) + 1
      : null,
  };
}
