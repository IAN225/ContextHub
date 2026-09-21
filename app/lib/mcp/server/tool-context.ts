import type { Workspace } from '../../core/model.ts';
import type { McpToken } from '../contracts.ts';
export type ToolContext = {
  workspace: Workspace;
  token: McpToken;
  args: Record<string, unknown>;
  origin?: string;
  fetcher?: typeof fetch;
  fields: { workspace_id: string; workspace: string; read_at: string };
};
