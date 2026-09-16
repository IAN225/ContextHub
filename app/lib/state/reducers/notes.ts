import { type Workspace } from '../../core/model.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applyNotes(
  w: Workspace,
  command: Extract<
    WorkspaceCommand,
    { type: 'note/create' | 'note/save' | 'note/star' | 'note/status' }
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
            ? {
                ...n,
                title: command.title.trim() || '无标题 Note',
                body: command.body,
                editor: command.editor,
                updatedAt: command.at,
                versions: [
                  { title: n.title, body: n.body, time: n.updatedAt },
                  ...n.versions,
                ].slice(0, 5),
              }
            : n,
        ),
      };
    }
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
