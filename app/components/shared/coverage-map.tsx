import { type Workspace } from '../../lib/core/model.ts';
import { coverage } from '../../lib/summary/coverage.ts';
export function ChainMap({
  w,
  selectedTurnId,
  includeInactive = false,
  compact = false,
}: {
  w: Workspace;
  selectedTurnId?: string;
  includeInactive?: boolean;
  compact?: boolean;
}) {
  const c = coverage(w);
  const turns = includeInactive
    ? w.turns
    : w.turns.filter((t) => t.status === 'normal');
  const n = Math.max(1, turns.length);
  const selectedIndex = turns.findIndex((t) => t.id === selectedTurnId);
  const selectedNumber = w.turns.findIndex((t) => t.id === selectedTurnId) + 1;
  const inactiveCount = turns.filter((t) => t.status !== 'normal').length;
  const recent = new Set(c.recent.map((t) => t.id)),
    cov = new Set(c.covered.map((t) => t.id)),
    gap = new Set(c.gap.map((t) => t.id));
  const runs: { type: string; count: number; start: number }[] = [];
  turns.forEach((t, i) => {
    const type =
      t.status !== 'normal'
        ? t.status
        : recent.has(t.id)
          ? 'recent'
          : gap.has(t.id)
            ? 'gap'
            : cov.has(t.id)
              ? 'covered'
              : 'pending';
    if (runs.at(-1)?.type === type) runs[runs.length - 1].count++;
    else runs.push({ type, count: 1, start: i });
  });
  return (
    <div
      className={`chain${compact ? ' chain-compact' : ''}${includeInactive ? ' chain-positioned' : ''}`}
    >
      <div className="chain-track">
        {runs.map((r, i) => (
          <div
            key={i}
            style={{ flex: r.count / n, minWidth: r.count ? 6 : 0 }}
            className={`chain-run coverage-${r.type}`}
            title={`${{ covered: '摘要已覆盖', recent: '近期原文', gap: '记忆缺口', pending: '待压缩', deprecated: '弃用 · 不参与召回', trash: '回收站 · 不参与召回' }[r.type]} · ${r.count} 轮`}
          >
            {selectedIndex >= r.start && selectedIndex < r.start + r.count && (
              <svg
                className="chain-cursor"
                viewBox="0 0 12 24"
                aria-label={`当前第 ${selectedNumber} 轮，共 ${w.turns.length} 轮`}
                style={{
                  left: `${((selectedIndex - r.start + 0.5) / r.count) * 100}%`,
                }}
              >
                <title>{`读到这里 · 第 ${selectedNumber} 轮`}</title>
                <path d="M6 14V24" stroke="currentColor" />
                <path d="M1 0H11V16L6 12L1 16Z" fill="currentColor" />
                <path d="M3 2H9" stroke="#f7efd8" strokeOpacity="0.65" />
              </svg>
            )}
          </div>
        ))}
      </div>
      {!compact && (
        <div className="chain-labels">
          <span>
            <i className="coverage-covered" />
            摘要覆盖 {c.covered.length} 轮
          </span>
          {c.gap.length > 0 && (
            <span className="amber">
              <i className="coverage-gap" />
              缺口 {c.gap.length} 轮
            </span>
          )}
          {c.queued.length > 0 && (
            <span>
              <i className="coverage-pending" />
              待压缩 {c.queued.length} 轮
            </span>
          )}
          {inactiveCount > 0 && (
            <span>
              <i className="coverage-inactive" />
              不参与召回 {inactiveCount} 轮
            </span>
          )}
          <span>
            <i className="coverage-recent" />
            原文窗口 {c.recent.length} 轮
          </span>
        </div>
      )}
    </div>
  );
}
