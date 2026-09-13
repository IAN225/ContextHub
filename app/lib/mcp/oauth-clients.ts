export type OAuthRedirectRule =
  | { kind: 'exact'; uri: string }
  | { kind: 'https-path'; origin: string; path: RegExp }
  | {
      kind: 'loopback';
      hosts: readonly string[];
      path: string;
      minPort: number;
      maxPort: number;
    };
export type OAuthClientProfile = {
  id: string;
  name: string;
  avatar?: { mark: 'message' | 'spark'; tone: 'sage' | 'clay' };
  redirects: readonly OAuthRedirectRule[];
  // Profiles with setup instructions appear in the connection picker.
  instructions?: readonly string[];
};

// One trusted registration per supported client. Adding a DCR/PKCE client
// changes this table, not the authorization, token or UI control flow.
export const oauthClientProfiles: readonly OAuthClientProfile[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    avatar: { mark: 'message', tone: 'sage' },
    redirects: [
      {
        kind: 'exact',
        uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      },
      {
        kind: 'https-path',
        origin: 'https://chatgpt.com',
        path: /^\/connector\/oauth\/[a-zA-Z0-9_-]{1,200}$/,
      },
    ],
    instructions: [
      '桌面端添加 Streamable HTTP 服务器，只填写地址，Bearer 令牌环境变量和标头留空。保存后回到服务器列表，重新启动连接，再点击「身份验证」。动态注册由客户端自动完成。',
      '网页端使用插件入口，可能需要开发者模式与工作区权限；不会读取桌面端的 MCP 配置。',
    ],
  },
  {
    id: 'claude',
    name: 'Claude',
    avatar: { mark: 'spark', tone: 'clay' },
    redirects: [
      { kind: 'exact', uri: 'https://claude.ai/api/mcp/auth_callback' },
    ],
    instructions: [
      '在 Claude 的设置 → 连接器中添加自定义连接器，填写此 HTTPS 地址，OAuth Client ID 和 Secret 留空，按提示连接。网页、桌面和移动端共用远程连接器；Claude Code 的本机配置是另一种接入方式。',
    ],
  },
  {
    id: 'native',
    name: '本机 MCP 客户端',
    redirects: [
      {
        kind: 'loopback',
        hosts: ['127.0.0.1', '[::1]'],
        path: '/callback',
        minPort: 1024,
        maxPort: 65535,
      },
    ],
  },
];

function matchesRedirect(value: string, rule: OAuthRedirectRule) {
  if (rule.kind === 'exact') return value === rule.uri;
  try {
    const url = new URL(value);
    // Reject normalization aliases, credentials, queries, fragments and ports
    // stripped by URL parsing. Stored redirects still match exactly during
    // authorization and exchange, including each native client's actual port.
    if (value !== url.origin + url.pathname) return false;
    if (rule.kind === 'https-path')
      return (
        url.protocol === 'https:' &&
        url.origin === rule.origin &&
        url.pathname.match(rule.path)?.[0] === url.pathname
      );
    const port = Number(url.port);
    return (
      url.protocol === 'http:' &&
      rule.hosts.includes(url.hostname) &&
      url.pathname === rule.path &&
      port >= rule.minPort &&
      port <= rule.maxPort
    );
  } catch {
    return false;
  }
}
export function resolveOAuthClient(
  value: unknown,
  profiles = oauthClientProfiles,
) {
  if (typeof value !== 'string') return null;
  const matches = profiles.filter((profile) =>
    profile.redirects.some((rule) => matchesRedirect(value, rule)),
  );
  // An overlapping configuration must not silently pick another identity.
  return matches.length === 1 ? matches[0] : null;
}
export function oauthClientName(value: unknown): string | null {
  return resolveOAuthClient(value)?.name ?? null;
}
export const oauthConnectionProfiles = oauthClientProfiles.filter(
  (profile) => profile.instructions?.length,
);
