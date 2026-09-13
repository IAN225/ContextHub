import { McpError } from './contracts';
export async function mcpRequest<T>(
  action: string,
  value?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/mcp/${action}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: {
      'X-Context-Hub': '1',
      ...(value === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    credentials: 'same-origin',
    cache: 'no-store',
    body: value === undefined ? undefined : JSON.stringify(value),
    signal,
  });
  const data = (await response.json()) as T & {
    error?: { code?: string; message?: string };
  };
  if (!response.ok)
    throw new McpError(
      data.error?.code ?? 'MCP_UNAVAILABLE',
      data.error?.message ?? 'MCP 服务未就绪，请启动更新后的本机服务。',
      response.status,
    );
  return data as T;
}
