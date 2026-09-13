import type { Attachment, Summary, Workspace, Upload } from '../domain.ts';
export type TaskStatus =
  | 'queued'
  | 'running'
  | 'pausing'
  | 'paused'
  | 'failed'
  | 'completed'
  | 'cancelled';
export type TaskKind = 'summary' | 'workbench' | 'attachments';
export type BackgroundTask = {
  id: string;
  kind: TaskKind;
  title: string;
  workspace_id: string | null;
  status: TaskStatus;
  step: number;
  total: number;
  acknowledged: number;
  error: string | null;
  created_at: number;
  updated_at: number;
};
export type TaskRecord = BackgroundTask & {
  owner_id: string;
  request_hash: string;
  connection_hash: string | null;
  lease: string | null;
  lease_until: number | null;
};
export type SummaryTaskState = { workspace: Workspace };
export type WorkbenchTaskState = {
  workspace: Workspace;
  turnIds: string[];
  summaryId: string;
  instruction: string;
};
export type AttachmentTaskState = { attachments: Attachment[] };
export type SummaryTaskResult = {
  kind: 'summary';
  expectedHash: string;
  summary: Summary;
  turnIds: string[];
};
export type AttachmentTaskResult = {
  kind: 'attachments';
  expected: string;
  attachment: Attachment;
};
export type WorkbenchTaskResult = { kind: 'workbench'; upload: Upload };
export type TaskResult =
  | SummaryTaskResult
  | AttachmentTaskResult
  | WorkbenchTaskResult;
export const MAX_TASK_BYTES = 16 * 1024 * 1024;
export const TASK_LEASE_MS = 180000;
export const taskLabels: Record<TaskStatus, string> = {
  queued: '排队中',
  running: '处理中',
  pausing: '本批完成后暂停',
  paused: '已暂停',
  failed: '处理失败',
  completed: '已完成',
  cancelled: '已取消',
};
export class TaskError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function publicTask(task: TaskRecord): BackgroundTask {
  const {
    id,
    kind,
    title,
    workspace_id,
    status,
    step,
    total,
    acknowledged,
    error,
    created_at,
    updated_at,
  } = task;
  return {
    id,
    kind,
    title,
    workspace_id,
    status,
    step,
    total,
    acknowledged,
    error,
    created_at,
    updated_at,
  };
}
