import { uid } from '../core/identity.ts';
import { type Workspace } from '../core/model.ts';

export function blankWorkspace(name: string, platform = '手动导入'): Workspace {
  return {
    id: uid(),
    name,
    platform,
    turns: [],
    summaries: [],
    activeId: null,
    watermark: null,
    retain: 6,
    retainMode: 'turns',
    retainTokens: 8000,
    notes: [],
    blocks: [
      { id: uid(), type: 'summary' },
      { id: uid(), type: 'recent' },
      { id: uid(), type: 'stars' },
    ],
    tokens: [],
    config: { configured: false, auto: false, batch: 20, review: true },
    started: false,
    firstComplete: false,
  };
}
