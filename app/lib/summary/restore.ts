import { type Workspace } from '../core/model.ts';

export function restoreSummary(
  w: Workspace,
  id: string,
  mode: 'keep' | 'rewind',
): Workspace {
  const s = w.summaries.find((s) => s.id === id);
  if (!s) return w;
  const last = w.turns.filter((t) => s.covered.includes(t.id)).at(-1);
  return {
    ...w,
    activeId: id,
    watermark: mode === 'rewind' ? (last?.id ?? null) : w.watermark,
  };
}
