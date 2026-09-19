import { type WorkspaceContext } from '../core/model.ts';

export function restoreSummary<T extends WorkspaceContext>(
  w: T,
  id: string,
  mode: 'keep' | 'rewind',
): T {
  const s = w.summaries.find((s) => s.id === id);
  if (!s) return w;
  const last = w.turns.filter((t) => s.covered.includes(t.id)).at(-1);
  return {
    ...w,
    activeId: id,
    watermark: mode === 'rewind' ? (last?.id ?? null) : w.watermark,
  };
}
