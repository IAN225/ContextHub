import { SHARE_MAX_BYTES } from '../share-transport.ts';
import { readClaudeSnapshot } from './claude-browser.ts';
import { resolveChatGPTAssets } from './chatgpt-assets.ts';
import { readLimitedBody } from './http.ts';
import { createImport, ImportError } from '../contracts.ts';
import { shareProviders } from '../share-providers.ts';

export function resolveShareUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ImportError(
      'INVALID_URL',
      '请填写完整的官方 HTTPS 分享链接。',
      400,
    );
  }
  const provider = shareProviders.find((p) => p.host === url.hostname);
  const match =
    /^\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
      url.pathname,
    );
  if (
    !provider ||
    !match ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password
  )
    throw new ImportError(
      'UNSUPPORTED_LINK',
      '目前支持 ChatGPT 和 Claude 的官方公开分享链接。',
      400,
    );
  return {
    provider,
    id: match[1],
    canonical: `https://${provider.host}/share/${match[1]}`,
  };
}

export async function importShare(
  link: string,
  title = '',
  fetcher: typeof fetch = fetch,
  claudeReader: (id: string) => Promise<Response> = readClaudeSnapshot,
) {
  const { provider, id, canonical } = resolveShareUrl(link);
  let response: Response | undefined;
  try {
    // Fetch only a provider-constructed URL; never follow redirects into arbitrary hosts.
    response =
      provider.id === 'claude-share'
        ? await claudeReader(id)
        : await fetcher(provider.resource(id), {
            redirect: 'manual',
            signal: AbortSignal.timeout(20000),
            headers: {
              'User-Agent': 'ContextHub/0.2 (conversation importer)',
              Accept:
                provider.host === 'claude.ai'
                  ? 'application/json'
                  : 'text/html',
            },
          });
    if (response.headers.get('cf-mitigated') === 'challenge')
      throw new ImportError(
        'SOURCE_CHALLENGE',
        `${provider.label}要求完成 Cloudflare 安全验证，当前服务器无法直接读取。可在来源页面打开对话后，通过手动导入上传内容。`,
        502,
      );
    if (response.status === 429)
      throw new ImportError(
        'SOURCE_RATE_LIMITED',
        `${provider.label}暂时限制了请求频率，请稍后重试。`,
        502,
      );
    if ([401, 403].includes(response.status))
      throw new ImportError(
        'SOURCE_RESTRICTED',
        `${provider.label}限制了服务器读取。浏览器可打开不代表服务器可访问，请复制对话后手动导入。`,
        502,
      );
    if ([404, 410].includes(response.status))
      throw new ImportError(
        'SHARE_UNAVAILABLE',
        '分享已失效或被删除，请重新生成链接。',
        404,
      );
    if (!response.ok)
      throw new ImportError(
        'SOURCE_UNAVAILABLE',
        '暂时无法读取分享，可能已跳转或不可公开访问。',
        502,
      );
    const body = await readLimitedBody(response, SHARE_MAX_BYTES);
    try {
      const parsed = provider.parse(body);
      return createImport(
        provider.id === 'chatgpt-share'
          ? await resolveChatGPTAssets(parsed, id, fetcher, response.headers)
          : parsed,
        provider,
        'link',
        title,
        canonical,
      );
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError(
        'SHARE_FORMAT_CHANGED',
        '分享数据格式无法识别，解析器需要更新。请先使用手动复制导入。',
      );
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (
      error instanceof Error &&
      ['TimeoutError', 'AbortError'].includes(error.name)
    )
      throw new ImportError(
        'SOURCE_TIMEOUT',
        '读取分享超时，请稍后重试，或使用手动复制导入。',
        504,
      );
    throw new ImportError(
      'SOURCE_READ_FAILED',
      '暂时无法连接分享来源，请检查网络后重试，或使用手动复制导入。',
      502,
    );
  } finally {
    if (response?.body && !response.bodyUsed)
      await response.body.cancel().catch(() => {});
  }
}
