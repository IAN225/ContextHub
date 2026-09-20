import { createMemorySearch } from '../../memory/search.ts';
import { memoryText } from '../../memory/compose.ts';
import { coverage } from '../../summary/coverage.ts';
import { parseSummaryEngine, summaryWorkspace } from '../../summary/engines.ts';
import { McpError } from '../contracts.ts';
import { noteResult } from './notes.ts';
import { summaryResult, summaryState } from './presenters.ts';
import { readConversation } from './transcript.ts';
import type { ToolContext } from './tool-context.ts';

function excerpt(text: string, query: string) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  let start = Math.max(0, at - 70);
  // Only materialize a short Unicode window, not an array of an entire large turn.
  if (start && /[\uDC00-\uDFFF]/.test(text[start])) start--;
  const snippet = Array.from(text.slice(start, start + 560))
    .slice(0, 276)
    .join('');
  return `${start ? '…' : ''}${snippet}${start + snippet.length < text.length ? '…' : ''}`;
}
export async function readTool(
  name: string,
  ctx: ToolContext,
): Promise<object> {
  const { workspace: w, args, fields } = ctx;
  switch (name) {
    case 'conversation_read':
      return readConversation(w, args, ctx.token, ctx.origin);
    case 'memory_bootstrap': {
      const engine = parseSummaryEngine(w.memoryEngine);
      const scoped = summaryWorkspace(w, engine),
        c = coverage(scoped);
      return {
        ...fields,
        content: memoryText(scoped),
        engine,
        summary_id: c.active?.id ?? null,
        covered_turn_ids: c.active?.covered ?? [],
        recent_turn_ids: c.recent.map((t) => t.id),
        omitted_turn_ids: [...c.gap, ...c.queued].map((t) => t.id),
        status: c.active ? 'ready' : 'no_summary',
        strategy_version:
          c.active?.generation?.strategy ??
          (engine === 'custom' ? 'custom-v1' : null),
      };
    }
    case 'notes_list': {
      const notes = w.notes.filter((n) => n.status === 'normal'),
        offset = Number(args.offset),
        limit = Number(args.limit);
      return {
        ...fields,
        total: notes.length,
        items: notes.slice(offset, offset + limit).map((n) => ({
          id: n.id,
          title: n.title,
          star: n.star,
          ...(n.star
            ? { preview: Array.from(n.body).slice(0, 50).join('') }
            : {}),
        })),
        next_offset: offset + limit < notes.length ? offset + limit : null,
      };
    }
    case 'note_read':
      return noteResult(ctx);
    case 'summary_read': {
      const engine = parseSummaryEngine(args.engine ?? w.memoryEngine);
      const state = await summaryState(w, engine);
      const selected =
        args.summary_id === undefined
          ? state.active
          : summaryWorkspace(w, engine).summaries.find(
              (s) => s.id === args.summary_id,
            );
      if (args.summary_id !== undefined && !selected)
        throw new McpError('SUMMARY_NOT_FOUND', '此方案中没有该摘要。', 404);
      return {
        ...fields,
        engine,
        revision: state.revision,
        active_id: state.active?.id ?? null,
        summary: summaryResult(selected),
        total_turns: state.total_turns,
        recent_from_turn: state.recent_from_turn,
      };
    }
    case 'memory_search': {
      const query = String(args.query).trim(),
        offset = Number(args.offset),
        limit = Number(args.limit);
      const engine = parseSummaryEngine(args.engine ?? w.memoryEngine);
      const found = createMemorySearch()([summaryWorkspace(w, engine)], {
        query,
        kind: String(args.kind),
        scope: w.id,
        limit: offset + limit,
      });
      const numbers = new Map(w.turns.map((t, i) => [t.id, i + 1]));
      return {
        ...fields,
        engine,
        total: found.total,
        items: found.items.slice(offset, offset + limit).map((item) => ({
          id: item.id,
          kind: item.kind,
          title: Array.from(item.title).slice(0, 200).join(''),
          excerpt: excerpt(item.text, query),
          ...(item.kind === 'turn' ? { number: numbers.get(item.id) } : {}),
        })),
        next_offset: offset + limit < found.total ? offset + limit : null,
      };
    }
    default:
      throw new McpError('UNKNOWN_TOOL', '没有实现该只读工具。');
  }
}
