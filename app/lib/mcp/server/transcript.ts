import type { Workspace } from '../../core/model.ts';
import { clientSummaryState } from '../../summary/client-compression.ts';
import {
  transcriptRange,
  transcriptTurns,
  type TranscriptRange,
} from '../../transcript/range.ts';
import { McpError, type McpToken } from '../contracts.ts';
import { sourceResult, turnResult } from './presenters.ts';
import { createDownload } from './transcript-download.ts';
export const TRANSCRIPT_PAGE_BYTES = 256 * 1024;
export function transcriptMetadata(
  w: Workspace,
  source: TranscriptRange | null,
) {
  let available = 0;
  if (source)
    for (let i = source.from - 1; i < source.to; i++)
      if (w.turns[i].status === 'normal') available++;
  return {
    workspace_id: w.id,
    workspace: w.name,
    total_turns: w.turns.length,
    available_turns: available,
    source: source ? sourceResult(source) : null,
    base_summary_revision: clientSummaryState(w).revision,
  };
}
export async function readConversation(
  w: Workspace,
  args: Record<string, unknown>,
  token: McpToken,
  origin?: string,
) {
  const from = Number(args.from_turn),
    to = Number(args.to_turn ?? w.turns.length);
  const source =
    !w.turns.length && from === 1 && args.to_turn === undefined
      ? null
      : transcriptRange(w, from, to);
  const meta = transcriptMetadata(w, source);
  if (args.mode === 'download') {
    if (!source || !meta.available_turns)
      throw new McpError('NO_TURNS', '所选范围没有可下载的正常原文。');
    if (!origin)
      throw new McpError(
        'DOWNLOAD_UNAVAILABLE',
        '请通过 MCP HTTP 连接获取下载地址。',
        503,
      );
    return {
      ...meta,
      download: await createDownload(
        origin,
        w.id,
        token,
        source,
        meta.base_summary_revision,
      ),
    };
  }
  const offset = Number(args.offset),
    limit = Number(args.limit);
  const turns: ReturnType<typeof turnResult>[] = [];
  let index = 0,
    bytes = 0,
    next: number | null = null;
  if (source)
    for (const original of transcriptTurns(w, source)) {
      if (index++ < offset) continue;
      const turn = turnResult(original),
        size = new TextEncoder().encode(JSON.stringify(turn)).length;
      if (turns.length >= limit || bytes + size > TRANSCRIPT_PAGE_BYTES) {
        if (!turns.length)
          throw new McpError(
            'TURN_TOO_LARGE',
            '此轮超过分页返回上限，请使用 mode=download。',
            413,
          );
        next = index - 1;
        break;
      }
      bytes += size;
      turns.push(turn);
    }
  return { ...meta, turns, next_offset: next };
}
