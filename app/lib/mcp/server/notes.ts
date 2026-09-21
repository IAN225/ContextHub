import { now, uid } from '../../core/identity.ts';
import type { Note } from '../../core/model.ts';
import { saveNote } from '../../notes/operations.ts';
import { digest } from '../../server/crypto.ts';
import type { HubCommand } from '../../state/contracts.ts';
import { McpError } from '../contracts.ts';
import { noteSignature } from '../snapshot.ts';
import type { ToolContext } from './tool-context.ts';
const revisionOf = (note: Note) => digest(noteSignature(note));
function findNote(ctx: ToolContext) {
  const note = ctx.workspace.notes.find(
    (n) => n.id === ctx.args.note_id && n.status === 'normal',
  );
  if (!note)
    throw new McpError(
      'NOTE_NOT_FOUND',
      '此工作区中没有可读取的该 Note。',
      404,
    );
  return note;
}
export async function noteResult(ctx: ToolContext) {
  const n = findNote(ctx);
  return {
    ...ctx.fields,
    id: n.id,
    title: n.title,
    body: n.body,
    star: n.star,
    updated_at: n.updatedAt,
    revision: await revisionOf(n),
  };
}
export async function writeNote(
  name: 'note_create' | 'note_replace',
  ctx: ToolContext,
): Promise<{ commands: HubCommand[]; result: object }> {
  const { workspace: w, token, args, fields } = ctx;
  if (name === 'note_create') {
    const at = now();
    const note: Note = {
      id: uid(),
      title: String(args.title).trim(),
      body: String(args.body),
      star: args.star as boolean,
      status: 'normal',
      createdAt: at,
      updatedAt: at,
      editor: token.name,
      source: 'MCP',
      versions: [],
    };
    return {
      commands: [
        {
          type: 'workspace',
          workspaceId: w.id,
          command: { type: 'note/create', note },
        },
      ],
      result: {
        ...fields,
        id: note.id,
        title: note.title,
        star: note.star,
        updated_at: at,
        revision: await revisionOf(note),
        saved: true,
      },
    };
  }
  const before = findNote(ctx);
  if ((await revisionOf(before)) !== args.revision)
    throw new McpError(
      'NOTE_CHANGED',
      'Note 已变化，请重新读取后再精准替换。',
      409,
    );
  const field = args.field === 'title' ? 'title' : 'body';
  const oldText = String(args.old_text),
    newText = String(args.new_text),
    at = before[field].indexOf(oldText);
  if (!oldText || at < 0 || before[field].indexOf(oldText, at + 1) !== -1)
    throw new McpError(
      'MATCH_NOT_UNIQUE',
      'old_text 必须非空并且精确匹配唯一一处；Note 未修改。',
      409,
    );
  const value =
    before[field].slice(0, at) +
    newText +
    before[field].slice(at + oldText.length);
  if (
    Array.from(value).length > (field === 'title' ? 200 : 65536) ||
    (field === 'title' && !value.trim())
  )
    throw new McpError(
      'INVALID_ARGUMENTS',
      '替换后正文或标题过长，或标题为空。',
    );
  const note = saveNote(
    before,
    {
      title: field === 'title' ? value : before.title,
      body: field === 'body' ? value : before.body,
      editor: token.name,
      at: now(),
    },
    { trimTitle: false, recordUnchanged: false },
  );
  const commands: HubCommand[] =
    note === before
      ? []
      : [
          {
            type: 'workspace',
            workspaceId: w.id,
            command: {
              type: 'note/replace',
              noteId: before.id,
              field,
              value,
              editor: token.name,
              at: note.updatedAt,
            },
          },
        ];
  return {
    commands,
    result: {
      ...fields,
      id: note.id,
      revision: await revisionOf(note),
      updated_at: note.updatedAt,
      saved: true,
    },
  };
}
