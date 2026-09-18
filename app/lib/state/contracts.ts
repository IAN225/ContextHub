import {
  type Attachment,
  type Block,
  type Config,
  type Note,
  type Status,
  type Token,
  type Turn,
  type Upload,
  type Workspace,
} from '../core/model.ts';
import type { McpEvent } from '../mcp/contracts.ts';
import { type SummaryEngine } from '../summary/engines.ts';
import { type GeneratedCheckpoint } from '../summary/planning.ts';
import { type WorkspaceAppearance } from '../workspace-appearance.ts';

export type NoteNotification = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  noteId: string;
  title: string;
  clientName: string;
  createdAt: string;
  read: boolean;
};

export type HubState = {
  schemaVersion: 1;
  workspaces: Workspace[];
  uploads: Upload[];
  deliveryReceipts?: string[];
  trashRestoredAt?: string;
  taskReceipts?: Record<string, number>;
  mcpReceipts?: string[];
  noteNotifications?: NoteNotification[];
};

export type WorkspaceCommand = WorkspaceCommandBody & {
  engine?: SummaryEngine;
};

type WorkspaceCommandBody =
  | { type: 'summary/tab'; value: SummaryEngine }
  | { type: 'memory/engine'; value: SummaryEngine }
  | { type: 'workspace/rename'; name: string }
  | {
      type: 'workspace/settings';
      name: string;
      appearance: WorkspaceAppearance;
    }
  | { type: 'turn/save'; turn: Turn; insert: boolean; afterId: string | null }
  | { type: 'turn/status'; turnId: string; status: Status; at: string }
  | { type: 'note/create'; note: Note }
  | {
      type: 'note/save';
      noteId: string;
      title: string;
      body: string;
      editor: string;
      at: string;
    }
  | { type: 'note/star'; noteId: string; at: string }
  | { type: 'note/status'; noteId: string; status: Status; at: string }
  | { type: 'summary/config'; patch: Partial<Config> }
  | {
      type: 'summary/retain';
      retain?: number;
      mode?: 'turns' | 'tokens';
      tokens?: number;
    }
  | { type: 'summary/generated'; generated: GeneratedCheckpoint }
  | { type: 'summary/restore'; summaryId: string; mode: 'keep' | 'rewind' }
  | { type: 'memory/set'; blocks: Block[] }
  | { type: 'token/create'; token: Token }
  | { type: 'token/revoke'; tokenId: string }
  | { type: 'token/rotate'; tokenId: string; token: Token };

export type HubCommand =
  | { type: 'notification/read'; notificationId: string }
  | { type: 'mcp/receive'; workspaceId: string; events: McpEvent[] }
  | { type: 'task/workbench'; taskId: string; step: number; upload: Upload }
  | {
      type: 'task/summary';
      taskId: string;
      step: number;
      workspaceId: string;
      generated: GeneratedCheckpoint;
    }
  | {
      type: 'task/attachment';
      taskId: string;
      step: number;
      expected: string;
      attachment: Attachment;
    }
  | { type: 'workspace'; workspaceId: string; command: WorkspaceCommand }
  | { type: 'workspace/create'; workspace: Workspace }
  | { type: 'workspace/delete'; workspaceId: string }
  | { type: 'upload/add'; upload: Upload }
  | { type: 'upload/receive'; uploads: Upload[] }
  | { type: 'upload/update'; upload: Upload }
  | { type: 'upload/remove'; uploadId: string }
  | {
      type: 'upload/archive';
      uploadId: string;
      target: string | Workspace;
      batchId: string;
      excludedTriggerId?: string;
    }
  | {
      type: 'upload/summary';
      uploadId: string;
      workspaceId: string;
      mode: 'keep' | 'rewind';
      at: string;
    };

export type SendWorkspaceCommand = (command: WorkspaceCommand) => void;
