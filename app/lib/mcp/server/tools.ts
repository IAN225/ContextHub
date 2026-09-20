import { digest } from '../../server/crypto.ts';
import {
  MCP_CONTRACT_VERSION,
  mcpTools,
  type ToolDefinition,
} from '../catalog.ts';
import { McpError, type McpToken } from '../contracts.ts';
import type { McpRepository } from './repository.ts';
import { readTool } from './read-tools.ts';
import { writeTool } from './write-tools.ts';
import { validateSchema } from './schema.ts';
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
function checkedResult(tool: ToolDefinition, result: object): object {
  const data = JSON.parse(JSON.stringify(result));
  try {
    validateSchema(tool.outputSchema, data, 'result', false);
  } catch {
    throw new McpError('INVALID_TOOL_RESULT', '工具结果未通过契约校验。', 500);
  }
  return data;
}
export async function callMcpTool(
  repo: McpRepository,
  token: McpToken,
  name: string,
  input: unknown,
  fetcher?: typeof fetch,
  origin?: string,
): Promise<object> {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) throw new McpError('UNKNOWN_TOOL', '工具不存在。');
  const args = validateSchema(
    tool.inputSchema,
    input === undefined ? {} : input,
  ) as Record<string, unknown>;
  const requestId = tool.annotations.readOnlyHint
    ? ''
    : String(args.request_id);
  const hash = await digest(
    JSON.stringify([MCP_CONTRACT_VERSION, name, canonical(args)]),
  );
  async function replay() {
    if (!requestId) return null;
    const receipt = await repo.receipt(token.id, requestId);
    if (!receipt) return null;
    if (receipt.request_hash !== hash)
      throw new McpError(
        'IDEMPOTENCY_CONFLICT',
        'request_id 已用于不同操作，请为新操作使用新编号。',
        409,
      );
    return JSON.parse(receipt.result_json) as object;
  }
  const previous = await replay();
  if (previous) return previous;
  const snapshot = await repo.read(token.owner_id, token.workspace_id);
  if (!snapshot)
    throw new McpError(
      'WORKSPACE_NOT_READY',
      '工作区已不存在或不可读取。',
      404,
    );
  const w = snapshot.workspace;
  const ctx = {
    workspace: w,
    token,
    args,
    fetcher,
    origin,
    fields: {
      workspace_id: w.id,
      workspace: w.name,
      read_at: snapshot.syncedAt,
    },
  };
  if (tool.annotations.readOnlyHint)
    return checkedResult(tool, await readTool(name, ctx));
  const prepared = await writeTool(name, ctx);
  const result = checkedResult(tool, prepared.result);
  try {
    await repo.commit(
      token.owner_id,
      w.id,
      snapshot.revision,
      prepared.commands,
      { token, requestId, hash, result },
    );
  } catch (error) {
    const replayed = await replay();
    if (replayed) return replayed;
    throw error;
  }
  return result;
}
