import type { Workspace, SummaryTrack } from '../domain.ts';
export type SummaryEngine = 'custom' | 'reme';
export const summaryEngines: SummaryEngine[] = ['custom', 'reme'];
export const engineLabels = {
  custom: '自定义压缩',
  reme: 'ReMeLight 风格（实验）',
};
export function parseSummaryEngine(value: unknown): SummaryEngine {
  if (value === undefined || value === null || value === 'custom')
    return 'custom';
  if (value === 'reme') return 'reme';
  throw new Error('未知摘要方案。');
}
export function emptyRemeTrack(): SummaryTrack {
  return {
    summaries: [],
    activeId: null,
    watermark: null,
    retain: 6,
    retainMode: 'tokens',
    retainTokens: 8000,
    config: {
      configured: false,
      modelEnabled: false,
      auto: false,
      review: true,
      batch: 20,
      batchMode: 'tokens',
      batchTokens: 16000,
      budget: 32000,
      maxOutput: 4000,
    },
    started: false,
    firstComplete: false,
  };
}
export function summaryTrack(w: Workspace): SummaryTrack {
  const {
    summaries,
    activeId,
    watermark,
    retain,
    retainMode,
    retainTokens,
    config,
    started,
    firstComplete,
  } = w;
  return {
    summaries,
    activeId,
    watermark,
    retain,
    retainMode,
    retainTokens,
    config,
    started,
    firstComplete,
  };
}
// Scoped views feed the planner/UI. Never persist a projection as a workspace.
export function summaryWorkspace(
  w: Workspace,
  engine: SummaryEngine,
): Workspace {
  if (w.summaryEngine === engine) return w;
  if (w.summaryEngine === 'reme')
    throw new Error('不能将实验摘要视图作为自定义摘要读取。');
  return engine === 'custom'
    ? { ...w, summaryEngine: 'custom' }
    : {
        ...w,
        ...(w.reme ?? emptyRemeTrack()),
        summaryEngine: 'reme',
        reme: undefined,
      };
}
