import { type SummaryEngine } from '../summary/engines.ts';
import type { WorkspaceAppearance } from '../workspace-appearance.ts';

export type Status = 'normal' | 'deprecated' | 'trash';

export type Message = {
  role: string;
  content: string;
  name?: string;
  callId?: string;
  attachmentIds?: string[];
  // Parsers carry media with its message; groupTurns moves bytes to the turn.
  attachments?: Attachment[];
};

export type Attachment = {
  id: string;
  name: string;
  type: string;
  url: string;
  status?: 'stored' | 'remote' | 'missing' | 'failed';
  sourceUrl?: string;
  reference?: string;
  size?: number;
  sha256?: string;
  text?: string;
  error?: string;
};

export type ImportProvenance = {
  parser: string;
  version: number;
  sourceUrl?: string;
  issues: { code: string; message: string }[];
};

export type Turn = {
  id: string;
  title: string;
  messages: Message[];
  status: Status;
  source: string;
  time: string | null;
  deletedAt?: string;
  attachments?: Attachment[];
  tokens?: number;
  cache?: number;
  provenance?: ImportProvenance;
};

export type Summary = {
  id: string;
  title: string;
  text: string;
  covered: string[];
  createdAt: string;
  generation?: {
    model: string;
    protocol: string;
    strategy?: string;
    usage?: { input?: number; output?: number };
  };
};

export type Note = {
  id: string;
  title: string;
  body: string;
  star: boolean;
  status: Status;
  createdAt: string;
  updatedAt: string;
  editor: string;
  source: string;
  deletedAt?: string;
  versions: { title: string; body: string; time: string }[];
};

export type Block = {
  id: string;
  type: 'text' | 'summary' | 'recent' | 'stars';
  text?: string;
  custom?: boolean;
  windowLength?: number;
  noteIds?: string[];
};

export type Token = {
  id: string;
  name: string;
  value: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  kind: 'token' | 'oauth';
};

export type Config = {
  configured: boolean;
  modelEnabled?: boolean;
  auto: boolean;
  batch: number;
  batchMode?: 'turns' | 'tokens';
  batchTokens?: number;
  review: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  protocol?: string;
  system?: string;
  promptBlocks?: Block[];
  budget?: number;
  maxOutput?: number;
  thinking?: string;
  outputField?: string;
};

export type SummaryTrack = Pick<
  Workspace,
  | 'summaries'
  | 'activeId'
  | 'watermark'
  | 'retain'
  | 'retainMode'
  | 'retainTokens'
  | 'config'
  | 'started'
  | 'firstComplete'
>;

export type Workspace = {
  appearance?: WorkspaceAppearance;
  reme?: SummaryTrack;
  summaryTab?: SummaryEngine;
  memoryEngine?: SummaryEngine;
  /** Present only on scoped task/UI views, never on canonical workspaces. */
  summaryEngine?: SummaryEngine;
  id: string;
  name: string;
  platform: string;
  turns: Turn[];
  summaries: Summary[];
  activeId: string | null;
  watermark: string | null;
  retain: number;
  retainMode?: 'turns' | 'tokens';
  retainTokens?: number;
  notes: Note[];
  blocks: Block[];
  tokens: Token[];
  config: Config;
  started: boolean;
  firstComplete?: boolean;
};

export type UploadChannel = 'api' | 'link' | 'manual' | 'workbench';

export type Upload = {
  id: string;
  title: string;
  source: string;
  turns: Turn[];
  warning?: string;
  kind: 'conversation' | 'summary';
  summaryText?: string;
  createdAt: string;
  workspaceId?: string;
  covered?: string[];
  channel?: UploadChannel;
  provenance?: ImportProvenance;
};
