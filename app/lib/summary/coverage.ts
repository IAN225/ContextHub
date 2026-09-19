import { type Turn, type WorkspaceContext } from '../core/model.ts';
import { estimateTurnTokens } from '../transcript/tokens.ts';

// A recent window is always a chronological suffix, independent of batch progress.
export function selectRetentionWindow(w: WorkspaceContext, turns: Turn[]) {
  if (w.retainMode !== 'tokens')
    return turns.slice(Math.max(0, turns.length - w.retain));
  const limit = w.retainTokens ?? 8000;
  const result: Turn[] = [];
  let used = 0;
  for (let offset = 0; offset < turns.length; offset++) {
    const turn = turns[turns.length - offset - 1];
    const tokens = estimateTurnTokens(turn);
    // Stop at the first whole turn that does not fit. Never truncate it or jump
    // over it to pick a smaller, more distant turn.
    if (used + tokens > limit) break;
    used += tokens;
    result.push(turn);
  }
  return result.reverse();
}

export function coverage(w: WorkspaceContext) {
  const active = w.summaries.find((s) => s.id === w.activeId);
  const included = new Set(active?.covered ?? []);
  const at = w.turns.findIndex((t) => t.id === w.watermark);
  const normal = w.turns.filter((t) => t.status === 'normal');
  const recent = selectRetentionWindow(
    w,
    w.turns.filter((t, i) => t.status === 'normal' && i > at),
  );
  const retainedAtEnd = new Set(
    selectRetentionWindow(w, normal).map((t) => t.id),
  );
  const recentIds = new Set(recent.map((t) => t.id));
  const covered = w.turns.filter(
    (t) => t.status === 'normal' && included.has(t.id),
  );
  const gap = w.turns.filter(
    (t, i) =>
      t.status === 'normal' &&
      i <= at &&
      !included.has(t.id) &&
      !recentIds.has(t.id),
  );
  const pending = w.turns.filter(
    (t, i) => t.status === 'normal' && i > at && !retainedAtEnd.has(t.id),
  );
  const queued = w.turns.filter(
    (t, i) =>
      t.status === 'normal' &&
      i > at &&
      !recentIds.has(t.id) &&
      !included.has(t.id),
  );
  return { active, covered, gap, pending, recent, queued, at };
}
