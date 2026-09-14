import type { WorkspaceSnapshotV1, Config, Summary } from './payload-v1.ts';
// v1 stays frozen; v2 adds isolated strategies and their state.
type TrackV2 = Pick<
  WorkspaceSnapshotV1,
  | 'summaries'
  | 'activeId'
  | 'watermark'
  | 'retain'
  | 'retainMode'
  | 'retainTokens'
  | 'started'
  | 'firstComplete'
> & { config: Config };
export type WorkspaceSnapshotV2 = WorkspaceSnapshotV1 & {
  summaryEngine?: 'custom' | 'reme';
  summaryTab?: 'custom' | 'reme';
  memoryEngine?: 'custom' | 'reme';
  reme?: TrackV2;
};
export type SummaryV2 = Summary & {
  generation?: NonNullable<Summary['generation']> & { strategy?: string };
};
export type { Attachment, Note, Upload } from './payload-v1.ts';

export type { Summary } from './payload-v1.ts';
