import { sha256 } from '@noble/hashes/sha2.js';
import type { Turn, WorkspaceContext } from '../core/model.ts';
import { SummaryError } from '../summary/contracts.ts';
export type TranscriptRange = { from: number; to: number; revision: string };
const encoder = new TextEncoder();
function project(t: Turn, number: number) {
  return {
    number,
    id: t.id,
    title: t.title,
    source: t.source,
    time: t.time,
    messages: t.messages.map(
      ({ role, content, name, callId, attachmentIds }) => ({
        role,
        content,
        name,
        callId,
        attachmentIds,
      }),
    ),
    attachments: (t.attachments ?? []).map(({ id, name, type, text }) => ({
      id,
      name,
      type,
      text,
    })),
  };
}
export function assertTranscriptRange(
  w: WorkspaceContext,
  from: number,
  to: number,
) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 1 ||
    to < from ||
    to > w.turns.length
  )
    throw new SummaryError(
      'INVALID_RANGE',
      '原文范围超出工作区，起点不能晚于终点。',
    );
}
/** Inactive positions are fingerprinted too, so restore/delete/reorder cannot change a read range silently. */
export function transcriptRange(
  w: WorkspaceContext,
  from: number,
  to: number,
): TranscriptRange {
  assertTranscriptRange(w, from, to);
  const hash = sha256
    .create()
    .update(
      encoder.encode(JSON.stringify(['transcript-range-v2', w.id, from, to])),
    );
  for (let i = from - 1; i < to; i++) {
    const t = w.turns[i];
    hash.update(
      encoder.encode(
        JSON.stringify(
          t.status === 'normal'
            ? project(t, i + 1)
            : { number: i + 1, id: t.id, status: t.status },
        ),
      ),
    );
  }
  return {
    from,
    to,
    revision: Array.from(hash.digest(), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join(''),
  };
}
export function* transcriptTurns(
  w: WorkspaceContext,
  range: Pick<TranscriptRange, 'from' | 'to'>,
) {
  for (let i = range.from - 1; i < range.to; i++) {
    const t = w.turns[i];
    if (t.status === 'normal') yield project(t, i + 1);
  }
}
