import type { AccountEnvironment } from './server.ts';
export function accountModelFetcher(
  env: AccountEnvironment,
): typeof fetch | undefined {
  if (env.CONTEXT_HUB_ACCOUNT_MODE !== '1') return undefined;
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    return fetch('http://127.0.0.1:4310/internal/model', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Context-Hub-Account-Key': env.CONTEXT_HUB_MCP_GATEWAY_KEY ?? '',
      },
      body: JSON.stringify({ url, headers, body: init?.body }),
      signal: init?.signal,
      redirect: 'manual',
    });
  };
}
