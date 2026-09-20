import {
  type SummaryTrack,
  type SummaryView,
  type WorkspaceContext,
} from '../core/model.ts';
export type ModelSummaryEngine = 'custom' | 'reme';
export type SummaryEngine = ModelSummaryEngine | 'client';
export const modelSummaryEngines: ModelSummaryEngine[] = ['custom', 'reme'];
export const summaryEngines: SummaryEngine[] = [
  ...modelSummaryEngines,
  'client',
];
export const engineLabels = {
  custom: '自定义压缩',
  client: '客户端压缩',
  reme: 'ReMeLight 风格（实验）',
};
export function parseSummaryEngine(value: unknown): SummaryEngine {
  if (value === undefined || value === null || value === 'custom')
    return 'custom';
  if (value === 'reme' || value === 'client') return value;
  throw new Error('未知摘要方案。');
}
export function parseModelSummaryEngine(value: unknown): ModelSummaryEngine {
  const engine = parseSummaryEngine(value);
  if (engine === 'client')
    throw new Error('客户端压缩由 MCP 客户端提交，不使用服务端模型。');
  return engine;
}
export function emptyClientTrack(): SummaryTrack {
  return { ...emptyRemeTrack(), retainMode: 'turns' };
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
export function summaryTrack(w: WorkspaceContext): SummaryTrack {
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
  w: WorkspaceContext,
  engine: SummaryEngine,
): SummaryView {
  if (w.summaryEngine === engine) return { ...w, summaryEngine: engine };
  if (w.summaryEngine && w.summaryEngine !== 'custom')
    throw new Error('不能从摘要投影视图读取其他方案。');
  return engine === 'custom'
    ? { ...w, summaryEngine: 'custom' }
    : {
        ...w,
        ...(engine === 'reme'
          ? (w.reme ?? emptyRemeTrack())
          : (w.client ?? emptyClientTrack())),
        summaryEngine: engine,
        reme: undefined,
        client: undefined,
      };
}
