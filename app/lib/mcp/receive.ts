import type { Workspace } from '../domain.ts';
import type { McpEvent } from './contracts.ts';
import { noteSignature } from './snapshot.ts';

export function receiveMcpNote(
  w: Workspace,
  event: Extract<McpEvent, { kind: 'note' }>,
): Workspace {
  const current = w.notes.find((n) => n.id === event.note.id);
  if (noteSignature(current) === noteSignature(event.note)) return w;
  if (noteSignature(current) === noteSignature(event.before)) {
    return {
      ...w,
      notes: current
        ? w.notes.map((n) => (n.id === current.id ? event.note : n))
        : [event.note, ...w.notes],
    };
  }
  // Preserve both independently edited versions. Never resurrect a Note that
  // the user trashed/deprecated or permanently removed while the page was away.
  const id = `mcp-conflict-${event.id}`;
  if (w.notes.some((n) => n.id === id)) return w;
  const status = current?.status ?? (event.before ? 'trash' : 'normal');
  const conflict = {
    ...event.note,
    id,
    title: `${event.note.title}（MCP 冲突副本）`,
    star: false,
    status,
    source: 'MCP · 并行修改已保留',
    ...(status === 'trash'
      ? { deletedAt: current?.deletedAt ?? event.note.updatedAt }
      : {}),
  };
  return { ...w, notes: [conflict, ...w.notes] };
}
