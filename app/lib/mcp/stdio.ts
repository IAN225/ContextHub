import { readTextBody } from '../server/body.ts';

export const STDIO_LIMIT = 1024 * 1024;
export function createStdioBridge(
  endpoint: string,
  token: string,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/mcp\/[^/]+$/.test(url.pathname) ||
    !/^ch_mcp_[a-f0-9]{64}$/.test(token)
  )
    throw new Error('请配置工作区的 HTTPS MCP 地址和有效令牌。');
  let version = '2025-11-25';
  return async (line: string): Promise<string | undefined> => {
    let id: unknown = null;
    let notification = false;
    try {
      if (new TextEncoder().encode(line).length > STDIO_LIMIT)
        throw new Error();
      const request: unknown = JSON.parse(line);
      if (!request || typeof request !== 'object' || Array.isArray(request))
        throw new Error();
      const input = request as Record<string, unknown>;
      if (
        input.jsonrpc !== '2.0' ||
        typeof input.method !== 'string' ||
        (input.id !== undefined &&
          input.id !== null &&
          typeof input.id !== 'string' &&
          typeof input.id !== 'number')
      )
        throw new Error();
      id = input.id ?? null;
      notification = input.id === undefined;
      const signal = AbortSignal.timeout(30000);
      const response = await fetcher(url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'MCP-Protocol-Version': version,
        },
        body: line,
      });
      if (notification || !response.ok) {
        await response.body?.cancel();
        if (notification) return;
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message:
              response.status === 401
                ? 'MCP 令牌无效、到期或已吊销。'
                : `MCP 返回 HTTP ${response.status}。`,
          },
        });
      }
      const result = JSON.parse(
        await readTextBody(response, 8 * STDIO_LIMIT, {
          tooLarge: () => new Error(),
          signal,
          aborted: () => new Error(),
        }),
      );
      if (!result || result.jsonrpc !== '2.0' || result.id !== id)
        throw new Error();
      if (
        input.method === 'initialize' &&
        typeof result.result?.protocolVersion === 'string'
      )
        version = result.result.protocolVersion;
      return JSON.stringify(result);
    } catch {
      if (!notification)
        return JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message:
              'MCP 请求失败，请检查地址与授权；写入重试时复用 request_id。',
          },
        });
    }
  };
}
// Bound a line before parsing; readline alone buffers an unlimited unfinished line.
export async function* stdioLines(input: AsyncIterable<Uint8Array>) {
  let chunks: Uint8Array[] = [],
    size = 0;
  for await (const chunk of input) {
    let start = 0;
    for (let i = 0; i <= chunk.length; i++) {
      if (i < chunk.length && chunk[i] !== 10) continue;
      const part = chunk.subarray(start, i);
      size += part.length;
      if (size > STDIO_LIMIT) throw new Error('MCP 输入超过 1 MB。');
      chunks.push(part);
      if (i < chunk.length) {
        const bytes = new Uint8Array(size);
        let at = 0;
        for (const c of chunks) {
          bytes.set(c, at);
          at += c.length;
        }
        yield new TextDecoder().decode(bytes).replace(/\r$/, '');
        chunks = [];
        size = 0;
      }
      start = i + 1;
    }
  }
  if (size) {
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    yield new TextDecoder().decode(bytes);
  }
}
