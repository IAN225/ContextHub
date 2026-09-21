import { type WorkspaceContext } from '../../core/model.ts';
import { applyGeneratedCheckpoint } from '../../summary/planning.ts';
import { restoreSummary } from '../../summary/restore.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applySummaries<T extends WorkspaceContext>(
  w: T,
  command: Extract<
    WorkspaceCommand,
    {
      type:
        | 'summary/config'
        | 'summary/retain'
        | 'summary/generated'
        | 'summary/restore';
    }
  >,
): T {
  switch (command.type) {
    case 'summary/config': {
      if (w.summaryEngine === 'client')
        throw new Error('客户端压缩不使用模型配置。');
      const config = { ...w.config, ...command.patch };
      if (config.review) config.auto = false;
      // A previously saved toggle never authorizes a newly connected paid model.
      if (config.modelEnabled && !w.config.modelEnabled)
        return {
          ...w,
          config: { ...config, auto: false },
          started: false,
          firstComplete: false,
        };
      return { ...w, config };
    }
    case 'summary/retain':
      if (w.summaryEngine === 'client')
        throw new Error('客户端原文保留范围由模型提交的摘要覆盖范围决定。');
      return {
        ...w,
        ...(command.retain !== undefined
          ? {
              retain: Math.max(
                1,
                Math.min(500, Math.floor(command.retain) || 1),
              ),
            }
          : {}),
        ...(command.mode ? { retainMode: command.mode } : {}),
        ...(command.tokens !== undefined
          ? {
              retainTokens: Math.max(
                1,
                Math.min(2000000, Math.floor(command.tokens) || 1),
              ),
            }
          : {}),
      };
    case 'summary/generated':
      if (w.summaryEngine === 'client')
        throw new Error('客户端摘要必须通过专用提交操作保存。');
      return applyGeneratedCheckpoint(w, command.generated);
    case 'summary/restore':
      return {
        ...restoreSummary(w, command.summaryId, command.mode),
        config: { ...w.config, auto: false },
      };
  }
}
