export type AccountEnvironment = {
  CONTEXT_HUB_ACCOUNT_MODE?: string;
  CONTEXT_HUB_MCP_GATEWAY_KEY?: string;
};
export function accountContext(
  request: Request,
  env: AccountEnvironment,
): string | null | Response {
  if (env.CONTEXT_HUB_ACCOUNT_MODE !== '1')
    return Response.json({ error: '账号服务未配置。' }, { status: 503 });
  const id = request.headers.get('x-context-hub-account');
  const key = request.headers.get('x-context-hub-account-key');
  if (
    !id ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !env.CONTEXT_HUB_MCP_GATEWAY_KEY ||
    key !== env.CONTEXT_HUB_MCP_GATEWAY_KEY
  )
    return Response.json(
      { error: '请先登录。' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  return id;
}
