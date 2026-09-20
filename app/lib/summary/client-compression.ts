import { sha256 } from '@noble/hashes/sha2.js';
import {
  type Summary,
  type Workspace,
  type WorkspaceContext,
} from '../core/model.ts';
import { SummaryError } from './contracts.ts';
import { emptyClientTrack } from './engines.ts';

export const CLIENT_SUMMARY_VERSION = 'client-v1';
export const MAX_CLIENT_SUMMARY_BYTES = 256 * 1024;
const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('');
/** Stable, one-based account order; omitted trash/deprecated turns leave gaps. */
export function* transcriptTurns(w: WorkspaceContext) {
  for (let index = 0; index < w.turns.length; index++) {
    const t = w.turns[index];
    if (t.status !== 'normal') continue;
    yield {
      number: index + 1,
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
}
export function sourceRevision(w: WorkspaceContext) {
  const hash = sha256
    .create()
    .update(encoder.encode(JSON.stringify(['transcript-v1', w.id])));
  for (const turn of transcriptTurns(w))
    hash.update(encoder.encode(JSON.stringify(turn)));
  return hex(hash.digest());
}
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
  sourceRevision: string;
  summaryRevision: string;
  from: number;
  to: number;
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
  if (input.sourceRevision !== sourceRevision(w))
    throw new SummaryError(
      'SOURCE_CHANGED',
      '原文已变化，请重新读取后提交摘要。',
      409,
    );
  const current = clientSummaryState(w);
  if (input.summaryRevision !== current.revision)
    throw new SummaryError(
      'SUMMARY_CHANGED',
      '客户端摘要已更新，请合并最新摘要后重新提交。',
      409,
    );
  if (
    !Number.isSafeInteger(input.from) ||
    !Number.isSafeInteger(input.to) ||
    input.from < 1 ||
    input.to < input.from ||
    input.to > w.turns.length ||
    w.turns[input.from - 1].status !== 'normal' ||
    w.turns[input.to - 1].status !== 'normal'
  )
    throw new SummaryError(
      'INVALID_RANGE',
      '范围必须使用原文读取返回的正常轮次编号，起点不能晚于终点。',
    );
  if (
    !input.text.trim() ||
    encoder.encode(input.text).length > MAX_CLIENT_SUMMARY_BYTES ||
    !input.title.trim() ||
    input.title.length > 200
  )
    throw new SummaryError(
      'INVALID_SUMMARY',
      '摘要标题不能为空且不超过 200 字；正文不能为空且不超过 256 KiB。',
    );
  const ids = new Set(current.active?.covered ?? []);
  for (const turn of w.turns.slice(input.from - 1, input.to))
    if (turn.status === 'normal') ids.add(turn.id);
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
