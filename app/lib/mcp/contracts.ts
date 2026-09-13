import type { Note, Upload, Workspace } from '../domain.ts';

export class McpError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.status = status;
  }
}
export const MAX_MCP_BYTES = 16 * 1024 * 1024;
export type McpEvent =
  | { id: string; kind: 'note'; before: Note | null; note: Note }
  | { id: string; kind: 'import'; upload: Upload };
export type Mirror = {
  workspace: Workspace;
  events: McpEvent[];
  receiptIds?: string[];
  syncedAt: string;
};
export type MirrorSnapshot = Mirror & { revision: string };
export type McpToken = {
  id: string;
  owner_id: string;
  workspace_id: string;
  name: string;
  secret_hash: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  resource?: string | null;
  grant_expires_at?: number | null;
};
export type PublicMcpToken = Omit<McpToken, 'secret_hash' | 'owner_id'>;
export function publicToken(token: McpToken): PublicMcpToken {
  const { secret_hash: _secret, owner_id: _owner, ...value } = token;
  return value;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new McpError('INVALID_ARGUMENTS', '参数必须是 JSON 对象。');
  return value as Record<string, unknown>;
}
