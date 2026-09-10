import { createInterface } from 'node:readline';

// Optional adapter for clients that launch a local stdio MCP process.
// stdout is exclusively JSON-RPC; secrets are never printed to stderr.
const endpoint = process.env.CONTEXT_HUB_MCP_URL ?? '';
const token = process.env.CONTEXT_HUB_MCP_TOKEN ?? '';
let url;
try {
  url = new URL(endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/mcp\/[^/]+$/.test(url.pathname) ||
    !/^ch_mcp_[a-f0-9]{64}$/.test(token)
  )
    throw new Error();
} catch {
  console.error(
    '请配置有效的本机 CONTEXT_HUB_MCP_URL 和 CONTEXT_HUB_MCP_TOKEN。',
  );
  process.exit(1);
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let version = '2025-11-25';
for await (const line of input) {
  if (!line.trim()) continue;
  let request;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('请求过大。');
    request = JSON.parse(line);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
        'MCP-Protocol-Version': version,
      },
      body: line,
      signal: AbortSignal.timeout(30000),
    });
    if (request.id === undefined) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        response.status === 401
          ? 'MCP 令牌无效、到期或已吊销。'
          : `本机 MCP 返回 HTTP ${response.status}。`,
      );
    }
    const result = await response.json();
    if (
      request.method === 'initialize' &&
      typeof result.result?.protocolVersion === 'string'
    )
      version = result.result.protocolVersion;
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (failure) {
    const message =
      failure instanceof Error &&
      (failure.message.startsWith('MCP ') ||
        failure.message.startsWith('本机 MCP') ||
        failure.message === '请求过大。')
        ? failure.message
        : '本机 MCP 请求失败，请确认 Context Hub 服务运行中；写入重试时复用 request_id。';
    if (!request || request.id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request?.id ?? null,
          error: { code: -32603, message },
        }) + '\n',
      );
  }
}
