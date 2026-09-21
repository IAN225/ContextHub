import { sha256 } from '@noble/hashes/sha2.js';
import { type Summary, type Workspace } from '../core/model.ts';
import { SummaryError } from './contracts.ts';
import { transcriptRange, type TranscriptRange } from '../transcript/range.ts';
import { emptyClientTrack } from './engines.ts';

export const CLIENT_SUMMARY_VERSION = 'client-v1';
export const MAX_CLIENT_SUMMARY_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
export function clientSummaryState(w: Workspace) {
  const track = w.client ?? emptyClientTrack();
  const active = track.summaries.find((s) => s.id === track.activeId) ?? null;
  return {
    revision: hex(
      sha256(
        encoder.encode(
          JSON.stringify([
            CLIENT_SUMMARY_VERSION,
            track.activeId,
            track.watermark,
            active,
          ]),
        ),
      ),
    ),
    active,
  };
}
export type ClientSubmission = {
  source: TranscriptRange;
  baseSummaryRevision: string;
  id: string;
  title: string;
  text: string;
  createdAt: string;
  model: string;
};
/** The summary and its exact coverage always form one domain transition. */
export function applyClientSummary(
  w: Workspace,
  input: ClientSubmission,
): Workspace {
  if (
    input.source.revision !==
    transcriptRange(w, input.source.from, input.source.to).revision
  )
    throw new SummaryError(
      'SOURCE_CHANGED',
      '所选范围内的原文已变化，请重新读取该范围后提交摘要。',
      409,
    );
  const current = clientSummaryState(w);
  if (input.baseSummaryRevision !== current.revision)
    throw new SummaryError(
      'SUMMARY_CHANGED',
      '客户端摘要已更新，请合并最新摘要后重新提交。',
      409,
    );
  if (
    !input.text.trim() ||
    encoder.encode(input.text).length > MAX_CLIENT_SUMMARY_BYTES ||
    !input.title.trim() ||
    Array.from(input.title).length > 200
  )
    throw new SummaryError(
      'INVALID_SUMMARY',
      '摘要标题不能为空且不超过 200 字；正文不能为空且不超过 256 KiB。',
    );
  const selected = w.turns
    .slice(input.source.from - 1, input.source.to)
    .filter((t) => t.status === 'normal');
  if (!selected.length)
    throw new SummaryError('INVALID_RANGE', '所选范围没有正常原文。');
  const ids = new Set(current.active?.covered ?? []);
  for (const turn of selected) ids.add(turn.id);
  const covered = w.turns
    .filter((t) => t.status === 'normal' && ids.has(t.id))
    .map((t) => t.id);
  const summary: Summary = {
    id: input.id,
    title: input.title.trim(),
    text: input.text,
    covered,
    createdAt: input.createdAt,
    generation: {
      model: input.model,
      protocol: 'mcp',
      strategy: CLIENT_SUMMARY_VERSION,
    },
  };
  const track = w.client ?? emptyClientTrack();
  return {
    ...w,
    client: {
      ...track,
      summaries: [...track.summaries, summary].slice(-30),
      activeId: summary.id,
      watermark: covered.at(-1) ?? null,
      config: {
        ...track.config,
        auto: false,
        configured: false,
        modelEnabled: false,
      },
      started: true,
      firstComplete: true,
    },
  };
}
