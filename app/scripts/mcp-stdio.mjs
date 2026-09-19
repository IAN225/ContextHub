import { createStdioBridge, stdioLines } from '../lib/mcp/stdio.ts';
// stdout is reserved for JSON-RPC. Credentials are read only from the environment.
try {
  const send = createStdioBridge(
    process.env.CONTEXT_HUB_MCP_URL ?? '',
    process.env.CONTEXT_HUB_MCP_TOKEN ?? '',
  );
  for await (const line of stdioLines(process.stdin)) {
    if (!line.trim()) continue;
    const result = await send(line);
    if (result !== undefined) process.stdout.write(result + '\n');
  }
} catch {
  console.error('MCP 适配器已停止。请检查 HTTPS 地址、令牌及输入大小。');
  process.exitCode = 1;
}
