import type { WorkspaceSnapshotV2, Upload as UploadV2 } from './payload-v2.ts';
import type { Turn as TurnV1 } from './payload-v1.ts';
export type Turn = Omit<TurnV1, 'title'>;
export type WorkspaceSnapshotV3 = Omit<WorkspaceSnapshotV2, 'turns'> & {
  turns: Turn[];
};
export type Upload = Omit<UploadV2, 'turns'> & { turns: Turn[] };
export type { Attachment, Summary } from './payload-v2.ts';
