import type { HubState } from './hub-state.ts';
import type { StorageEntry } from './repository.ts';
import type { Block } from './domain.ts';

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
type Deleted = { status: string; deletedAt?: string };
export function expiredTrash(item: Deleted, at: number, restoredAt?: string) {
  const deleted = Date.parse(item.deletedAt ?? '');
  const restored = Date.parse(restoredAt ?? '');
  return (
    item.status === 'trash' &&
    Number.isFinite(deleted) &&
    at - Math.max(deleted, Number.isFinite(restored) ? restored : deleted) >=
      TRASH_RETENTION_MS
  );
}
export function trashCounts(state: HubState, at = Date.now()) {
  const items = state.workspaces.flatMap((w) => [...w.turns, ...w.notes]);
  return {
    total: items.filter((item) => item.status === 'trash').length,
    expired: items.filter((item) =>
      expiredTrash(item, at, state.trashRestoredAt),
    ).length,
  };
}
export function purgeTrash(
  state: HubState,
  mode: 'expired' | 'all',
  at = Date.now(),
) {
  if (!Number.isFinite(at)) throw new Error('清理时间无效。');
  const drafts: StorageEntry[] = [];
  const removedByWorkspace = new Map<string, Set<string>>();
  let count = 0;
  const workspaces = state.workspaces.map((w) => {
    const remove = (item: Deleted) =>
      item.status === 'trash' &&
      (mode === 'all' || expiredTrash(item, at, state.trashRestoredAt));
    const removedTurns = new Set(w.turns.filter(remove).map((t) => t.id));
    const removedNotes = new Set(w.notes.filter(remove).map((n) => n.id));
    if (!removedTurns.size && !removedNotes.size) return w;
    count += removedTurns.size + removedNotes.size;
    removedByWorkspace.set(w.id, removedTurns);
    for (const id of removedTurns)
      drafts.push({ key: `turn-draft-${w.id}-${id}`, value: undefined });
    for (const id of removedNotes)
      drafts.push({ key: `note-draft-${w.id}-${id}`, value: undefined });
    const blocks = (values: Block[]) =>
      values.map((b) =>
        b.noteIds?.some((id) => removedNotes.has(id))
          ? { ...b, noteIds: b.noteIds.filter((id) => !removedNotes.has(id)) }
          : b,
      );
    const anchor = w.turns.findIndex((t) => t.id === w.watermark);
    const watermark =
      w.watermark && removedTurns.has(w.watermark)
        ? (w.turns
            .slice(0, anchor)
            .filter((t) => !removedTurns.has(t.id))
            .at(-1)?.id ?? null)
        : w.watermark;
    return {
      ...w,
      watermark,
      turns: w.turns.filter((t) => !removedTurns.has(t.id)),
      notes: w.notes.filter((n) => !removedNotes.has(n.id)),
      summaries: w.summaries.map((s) => ({
        ...s,
        covered: s.covered.filter((id) => !removedTurns.has(id)),
      })),
      blocks: blocks(w.blocks),
      config: {
        ...w.config,
        ...(w.config.promptBlocks
          ? { promptBlocks: blocks(w.config.promptBlocks) }
          : {}),
      },
    };
  });
  const next = count
    ? {
        ...state,
        workspaces,
        uploads: state.uploads.map((u) => {
          const removed = u.workspaceId
            ? removedByWorkspace.get(u.workspaceId)
            : undefined;
          return removed && u.covered
            ? { ...u, covered: u.covered.filter((id) => !removed.has(id)) }
            : u;
        }),
      }
    : state;
  return { state: next, drafts, count };
}
