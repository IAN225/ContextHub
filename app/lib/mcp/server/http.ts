import { managementGuard, sessionOwner } from '../../server/request.ts';
import { readTextBody } from '../../server/body.ts';
import { normalizeHubState } from '../../state/validation.ts';
import { McpError } from '../contracts.ts';
import { mcpWorkspace } from '../snapshot.ts';
import type { McpRepository } from './repository.ts';
export const COOKIE = 'context_hub_mcp';
export const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
export const requireManagementRequest = managementGuard(
  (message) => new McpError('FORBIDDEN', message, 403),
);
export function localOrigin(request: Request) {
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new McpError('FORBIDDEN', '当前 MCP 服务只接受本机地址。', 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin)
    throw new McpError('FORBIDDEN', '请求来源不允许访问本机 MCP。', 403);
}
export function readLimitedBody(response: Response | Request, limit: number) {
  return readTextBody(response, limit, {
    tooLarge: () =>
      new McpError('TOO_LARGE', '内容超过大小限制，请分批导入。', 413),
  });
}
export async function json(request: Request, limit: number) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new McpError('JSON_REQUIRED', '请使用 application/json 请求。', 415);
  try {
    return JSON.parse(await readLimitedBody(request, limit)) as unknown;
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    throw new McpError('INVALID_JSON', 'JSON 格式无效。');
  }
}
export function errorInfo(error: unknown) {
  if (error instanceof Error && 'code' in error && 'status' in error)
    return {
      code: String(error.code),
      message: error.message,
      status: Number(error.status) || 400,
    };
  return {
    code: 'INTERNAL_ERROR',
    message: '本机 MCP 操作失败，数据未确认写入，请使用同一 request_id 重试。',
    status: 500,
  };
}
export async function owner(request: Request, repo: McpRepository) {
  return sessionOwner(request, COOKIE, (hash) => repo.session(hash));
}
export function workspace(value: unknown) {
  try {
    const w = normalizeHubState({
      schemaVersion: 1,
      workspaces: [value],
      uploads: [],
    }).workspaces[0];
    if (!w.id || w.id.length > 200) throw new Error('Invalid id');
    return mcpWorkspace(w);
  } catch {
    throw new McpError(
      'INVALID_WORKSPACE',
      '工作区数据不完整，未更新授权副本。',
    );
  }
}
