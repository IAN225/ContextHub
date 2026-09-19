import type { Note } from '../core/model.ts';
export const NOTE_HISTORY_LIMIT = 5;
export function saveNote(
  before: Note,
  input: { title: string; body: string; editor: string; at: string },
  policy: { trimTitle: boolean; recordUnchanged: boolean },
): Note {
  const title = policy.trimTitle
    ? input.title.trim() || '无标题 Note'
    : input.title;
  if (
    !policy.recordUnchanged &&
    title === before.title &&
    input.body === before.body
  )
    return before;
  return {
    ...before,
    title,
    body: input.body,
    editor: input.editor,
    updatedAt: input.at,
    versions: [
      { title: before.title, body: before.body, time: before.updatedAt },
      ...before.versions,
    ].slice(0, NOTE_HISTORY_LIMIT),
  };
}
