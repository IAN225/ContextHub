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

export async function readLimitedBody(
  response: Response | Request,
  limit: number,
) {
  if (Number(response.headers.get('content-length')) > limit)
    throw new ImportError('TOO_LARGE', '内容超过大小限制，请分批导入。', 413);
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit)
        throw new ImportError(
          'TOO_LARGE',
          '内容超过大小限制，请分批导入。',
          413,
        );
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(buffer);
}

// Rejected local HTTP requests still need their wire body drained before the
// proxy can reuse the connection. Discard without retaining bytes in memory.
export async function discardRequestBody(request: Request): Promise<boolean> {
  if (!request.body || request.bodyUsed) return true;
  const reader = request.body.getReader();
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Drain timeout')), 2000);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) return true;
      bytes += value.byteLength;
      if (bytes > 8 * 1024 * 1024) return false;
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function importShare(
  link: string,
  title = '',
  fetcher: typeof fetch = fetch,
) {
  const { provider, id, canonical } = resolveShareUrl(link);
  try {
    // Fetch only a provider-constructed URL; never follow redirects into arbitrary hosts.
    const response = await fetcher(provider.resource(id), {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: {
        'User-Agent': 'ContextHub/0.1 (local conversation importer)',
        Accept:
          provider.host === 'claude.ai' ? 'application/json' : 'text/html',
      },
    });
    if ([401, 403, 429].includes(response.status))
      throw new ImportError(
        'SOURCE_RESTRICTED',
        '来源站点要求验证、登录或暂时限制访问，请稍后重试，或使用手动复制导入。',
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
    const body = await readLimitedBody(response, 8 * 1024 * 1024);
    try {
      return createImport(
        provider.parse(body),
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
  }
}
