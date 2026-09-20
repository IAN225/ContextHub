import { now, uid } from '../../core/identity.ts';
import { importShare } from '../../imports/server/share-service.ts';
import type { HubCommand } from '../../state/contracts.ts';
import {
  applyClientSummary,
  clientSummaryState,
} from '../../summary/client-compression.ts';
import { McpError } from '../contracts.ts';
import { writeNote } from './notes.ts';
import type { ToolContext } from './tool-context.ts';
export async function writeTool(
  name: string,
  ctx: ToolContext,
): Promise<{ commands: HubCommand[]; result: object }> {
  const { workspace: w, args, fields, token } = ctx;
  switch (name) {
    case 'note_create':
    case 'note_replace':
      return writeNote(name, ctx);
    case 'summary_submit': {
      const source = args.source as {
        from_turn: number;
        to_turn: number;
        revision: string;
      };
      const submission = {
        source: {
          from: source.from_turn,
          to: source.to_turn,
          revision: source.revision,
        },
        baseSummaryRevision: String(args.base_summary_revision),
        id: uid(),
        title: String(args.title),
        text: String(args.cumulative_summary),
        createdAt: now(),
        model: typeof args.model === 'string' ? args.model : token.name,
      };
      const next = applyClientSummary(w, submission),
        summary = next.client!.summaries.at(-1)!;
      return {
        commands: [
          {
            type: 'workspace',
            workspaceId: w.id,
            command: { type: 'summary/client', submission },
          },
        ],
        result: {
          ...fields,
          saved: true,
          engine: 'client',
          summary_id: summary.id,
          summary_revision: clientSummaryState(next).revision,
          source,
          covered_turn_ids: summary.covered,
          covered_turns: summary.covered.length,
          memory_engine: w.memoryEngine ?? 'custom',
        },
      };
    }
    case 'conversation_import': {
      const imported = await importShare(
        String(args.url),
        typeof args.title === 'string' ? args.title : '',
        ctx.fetcher,
      );
      const upload = {
        ...imported,
        workspaceId: w.id,
        channel: 'link' as const,
      };
      return {
        commands: [{ type: 'upload/add', upload }],
        result: {
          ...fields,
          upload_id: upload.id,
          title: upload.title,
          turns: upload.turns.length,
          status: 'pending_confirmation',
          message: '已保存到待确认收件，预览并归档后进入原文。',
        },
      };
    }
    default:
      throw new McpError('UNKNOWN_TOOL', '没有实现该写入工具。');
  }
}
