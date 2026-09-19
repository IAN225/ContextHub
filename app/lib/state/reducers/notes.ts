import { type Workspace } from '../../core/model.ts';
import { saveNote } from '../../notes/operations.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applyNotes(
  w: Workspace,
  command: Extract<
    WorkspaceCommand,
    {
      type:
        | 'note/create'
        | 'note/save'
        | 'note/replace'
        | 'note/star'
        | 'note/status';
    }
  >,
): Workspace {
  switch (command.type) {
    case 'note/create':
      return w.notes.some((n) => n.id === command.note.id)
        ? w
        : { ...w, notes: [command.note, ...w.notes] };
    case 'note/save': {
      if (!w.notes.some((n) => n.id === command.noteId))
        throw new Error('需要编辑的 Note 已不存在。');
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? saveNote(n, command, { trimTitle: true, recordUnchanged: true })
            : n,
        ),
      };
    }
    case 'note/replace':
      if (!w.notes.some((n) => n.id === command.noteId))
        throw new Error('Note 已不存在。');
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? saveNote(
                n,
                {
                  title: command.field === 'title' ? command.value : n.title,
                  body: command.field === 'body' ? command.value : n.body,
                  editor: command.editor,
                  at: command.at,
                },
                { trimTitle: false, recordUnchanged: false },
              )
            : n,
        ),
      };
    case 'note/star':
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? { ...n, star: !n.star, updatedAt: command.at }
            : n,
        ),
      };
    case 'note/status':
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? {
                ...n,
                status: command.status,
                deletedAt: command.status === 'trash' ? command.at : undefined,
              }
            : n,
        ),
      };
  }
}
