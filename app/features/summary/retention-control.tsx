'use client';
import { Picker } from '../../components/shared/picker.tsx';
import type { WorkspaceContext } from '../../lib/core/model.ts';
import type { SendWorkspaceCommand } from '../../lib/state/contracts.ts';
import { coverage } from '../../lib/summary/coverage.ts';
import { estimateTurnTokens } from '../../lib/transcript/tokens.ts';
export function RetentionControl({
  w,
  onCommand,
  beforeChange,
}: {
  w: WorkspaceContext;
  onCommand: SendWorkspaceCommand;
  beforeChange?: () => void;
}) {
  const c = coverage(w),
    retainTokenMode = w.retainMode === 'tokens';
  const recentTokens = c.recent.reduce(
    (sum, turn) => sum + estimateTurnTokens(turn),
    0,
  );
  return (
    <fieldset className="summary-limit" aria-label="近期原文保留窗口">
      <legend>近期原文</legend>
      <input
        aria-label={retainTokenMode ? '保留原文 token 上限' : '保留近期轮次数'}
        className={retainTokenMode ? 'token-limit-input' : ''}
        type="number"
        min={1}
        max={retainTokenMode ? 2000000 : 500}
        value={retainTokenMode ? (w.retainTokens ?? 8000) : w.retain}
        onChange={(e) => {
          beforeChange?.();
          onCommand({
            type: 'summary/retain',
            ...(retainTokenMode
              ? { tokens: Number(e.target.value) }
              : { retain: Number(e.target.value) }),
          });
        }}
      />
      <Picker
        label="原文窗口单位"
        value={w.retainMode ?? 'turns'}
        onChange={(mode) => {
          beforeChange?.();
          onCommand({
            type: 'summary/retain',
            mode: mode as 'turns' | 'tokens',
          });
        }}
        options={[
          { value: 'tokens', label: 'token' },
          { value: 'turns', label: '轮' },
        ]}
      />
      <span
        className="summary-limit-hint"
        title="根据当前原文窗口保守估算；只纳入完整轮次。"
      >
        估算：约
        {retainTokenMode ? c.recent.length : recentTokens.toLocaleString()}
        {retainTokenMode ? '轮' : ' token'}
      </span>
    </fieldset>
  );
}
