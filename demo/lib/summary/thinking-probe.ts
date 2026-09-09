import type { SummaryProbe, ThinkingEvidence } from './contracts.ts';
import { effort } from './providers/shared.ts';

export function thinkingProbe(
  setting: string,
  evidence?: ThinkingEvidence,
): SummaryProbe {
  const disabled = effort(setting) === 'none';
  const tokens = evidence?.tokens;
  const observed = evidence?.hasOutput || (tokens !== undefined && tokens > 0);
  if (observed) {
    const detail = [
      tokens === undefined ? '' : `接口报告思考 token 数为 ${tokens}。`,
      evidence?.hasOutput ? '响应包含非空思考输出。' : '',
      disabled
        ? '本次要求关闭思考，但响应仍包含思考证据，请检查模型或接口兼容性。'
        : '本次已观察到思考；该结果不用于证明 low/medium/high 强度准确生效。',
    ].join('');
    return {
      field: '思考设置',
      status: disabled ? '与设置不符' : '已观察到思考',
      detail,
    };
  }
  if (tokens === 0)
    return {
      field: '思考设置',
      status: '本次未产生思考',
      detail: `接口报告思考 token 数为 0，未观察到非空思考输出。${
        disabled
          ? '本次结果符合关闭思考设置。'
          : '本次样本没有产生思考，不能据此判定模型不支持思考。'
      }`,
    };
  return {
    field: '思考设置',
    status: '无法确认是否生效',
    detail:
      '接口未提供可用的思考 token 计数，也未观察到非空思考输出；缺少字段不能当作 0。',
  };
}
