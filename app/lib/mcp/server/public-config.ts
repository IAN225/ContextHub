import { McpError } from '../contracts.ts';

export type PublicMcpConfig = {
  CONTEXT_HUB_MCP_PUBLIC_ORIGIN?: string;
  CONTEXT_HUB_MCP_GATEWAY_KEY?: string;
};
export function publicOrigin(config: PublicMcpConfig) {
  const value = config.CONTEXT_HUB_MCP_PUBLIC_ORIGIN;
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.origin === value &&
      !url.username &&
      !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
// Only the bounded loopback gateway may translate a public request. Never trust
// Forwarded/Host headers supplied by a client to select the OAuth issuer.
export function gatewayRequest(request: Request, config: PublicMcpConfig) {
  const origin = publicOrigin(config);
  if (
    !origin ||
    !config.CONTEXT_HUB_MCP_GATEWAY_KEY ||
    request.headers.get('x-context-hub-gateway-key') !==
      config.CONTEXT_HUB_MCP_GATEWAY_KEY
  )
    throw new McpError(
      'FORBIDDEN',
      'OAuth HTTPS 入口尚未启用或请求来源无效。',
      403,
    );
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new McpError('FORBIDDEN', '无效的本机网关。', 403);
  return new Request(origin + url.pathname + url.search, request);
}
