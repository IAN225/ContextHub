import {
  coverage,
  type Summary,
  type Turn,
  type Workspace,
} from '../domain.ts';
import { composeSummaryInput } from './prompts.ts';
import { attachmentContext } from '../attachments.ts';
import {
  estimateInput,
  fitsBudget,
  MAX_SUMMARY_TEXT,
  SummaryError,
  type SummaryInput,
  type SummaryResult,
} from './contracts.ts';

export type SummaryPlan = {
  expected: string;
  input: SummaryInput;
  turnIds: string[];
  covered: string[];
  watermark: string;
  completes: boolean;
  estimatedInput: number;
};
// Exact semantic snapshot: an edit/restore/retain/config change while a model is
// running must not advance a stale watermark. Unrelated notebook names are free.
export function summaryRevision(w: Workspace) {
  return JSON.stringify({
    turns: w.turns.map((t) => ({
      ...t,
      messages: t.messages.map(
        ({ role, content, name, callId, attachmentIds }) => ({
          role,
          content,
          name,
          callId,
          attachmentIds,
        }),
      ),
      attachments: t.attachments?.map(attachmentContext),
    })),
    active: w.summaries.find((s) => s.id === w.activeId),
    activeId: w.activeId,
    watermark: w.watermark,
    retain: w.retain,
    retainMode: w.retainMode ?? 'turns',
    retainTokens:
      w.retainMode === 'tokens' ? (w.retainTokens ?? 8000) : undefined,
    config: { ...w.config, auto: undefined, review: undefined },
    notes: w.notes
      .filter((n) => n.status === 'normal')
      .map((n) => ({ id: n.id, title: n.title, star: n.star })),
  });
}
export function selectCompressionBatch(w: Workspace, c = coverage(w)) {
  const count = w.config.batch;
  const tokenMode = w.config.batchMode === 'tokens';
  const tokenLimit = w.config.batchTokens ?? 16000;
  if (!tokenMode && (!Number.isInteger(count) || count < 1 || count > 100))
    throw new SummaryError(
      'INVALID_BATCH',
      '每批轮次数需要是 1–100 之间的整数。',
    );
  if (
    tokenMode &&
    (!Number.isInteger(tokenLimit) || tokenLimit < 1 || tokenLimit > 2000000)
  )
    throw new SummaryError(
      'INVALID_BATCH',
      '每批 token 上限需要是 1–2000000 之间的整数。',
    );
  let batch: Turn[] = [];
  let input: SummaryInput | undefined;
  for (const turn of tokenMode ? c.pending : c.pending.slice(0, count)) {
    const candidate = composeSummaryInput(w, [...batch, turn], c.active);
    if (!fitsBudget(candidate)) break;
    if (
      tokenMode &&
      estimateInput(candidate.system, candidate.user) > tokenLimit
    )
      break;
    batch = [...batch, turn];
    input = candidate;
  }
  return { batch, input };
}
export function planCompression(w: Workspace): SummaryPlan | null {
  if (!w.config.configured || !w.config.modelEnabled)
    throw new SummaryError('MODEL_NOT_CONFIGURED', '请先保存摘要模型配置。');
  const c = coverage(w);
  if (!c.pending.length) return null;
  const { batch, input } = selectCompressionBatch(w, c);
  if (!input || !batch.length)
    throw new SummaryError(
      'TURN_OVER_BUDGET',
      '提示词、上一份摘要和下一完整轮次超出每批发送上限或模型预算。请提高上限、缩短提示词或降低输出预留；系统不会截断轮次。',
    );
  return {
    expected: summaryRevision(w),
    input,
    turnIds: batch.map((t) => t.id),
    covered: [
      ...new Set([...(c.active?.covered ?? []), ...batch.map((t) => t.id)]),
    ],
    watermark: batch.at(-1)!.id,
    completes: batch.length === c.pending.length,
    estimatedInput: estimateInput(input.system, input.user),
  };
}
export function planWorkbench(
  w: Workspace,
  turns: Turn[],
  previous?: Summary,
  instruction = '',
) {
  if (!w.config.modelEnabled)
    throw new SummaryError(
      'MODEL_NOT_CONFIGURED',
      '请先保存真实摘要模型配置。',
    );
  if (!turns.length)
    throw new SummaryError('NO_TURNS', '请选择至少一个正常状态的完整轮次。');
  const input = composeSummaryInput(w, turns, previous, instruction);
  if (!fitsBudget(input))
    throw new SummaryError(
      'WORKBENCH_OVER_BUDGET',
      '所选完整轮次超出当前预算。请缩小轮次范围或调整预算，工作台不会静默省略内容。',
    );
  return {
    input,
    covered: [
      ...new Set([...(previous?.covered ?? []), ...turns.map((t) => t.id)]),
    ],
  };
}
export type GeneratedCheckpoint = {
  expected: string;
  summary: Summary;
  turnIds: string[];
};
export function checkpointFromResult(
  plan: SummaryPlan,
  result: SummaryResult,
  id: string,
  createdAt: string,
): GeneratedCheckpoint {
  if (!result.text.trim() || result.text.length > MAX_SUMMARY_TEXT)
    throw new SummaryError('INVALID_SUMMARY', '模型没有返回可保存的完整摘要。');
  return {
    expected: plan.expected,
    turnIds: plan.turnIds,
    summary: {
      id,
      createdAt,
      title: '增量摘要',
      text: result.text,
      covered: plan.covered,
      generation: {
        model: result.model,
        protocol: result.protocol,
        usage: result.usage,
      },
    },
  };
}
export function applyGeneratedCheckpoint(
  w: Workspace,
  generated: GeneratedCheckpoint,
): Workspace {
  if (w.summaries.some((s) => s.id === generated.summary.id)) return w;
  if (summaryRevision(w) !== generated.expected)
    throw new SummaryError(
      'STALE_SUMMARY',
      '原文、摘要或压缩配置已经变化，本次结果未推进处理水位。请重新压缩。',
      409,
    );
  const plan = planCompression(w);
  if (
    !plan ||
    JSON.stringify(plan.turnIds) !== JSON.stringify(generated.turnIds) ||
    JSON.stringify(plan.covered) !== JSON.stringify(generated.summary.covered)
  )
    throw new SummaryError(
      'STALE_SUMMARY',
      '批次范围已经变化，未保存过期结果。',
      409,
    );
  if (
    !generated.summary.text.trim() ||
    generated.summary.text.length > MAX_SUMMARY_TEXT
  )
    throw new SummaryError('INVALID_SUMMARY', '摘要正文无效。');
  return {
    ...w,
    summaries: [...w.summaries, generated.summary].slice(-30),
    activeId: generated.summary.id,
    watermark: plan.watermark,
    started: true,
    firstComplete: !!w.firstComplete || plan.completes,
  };
}
