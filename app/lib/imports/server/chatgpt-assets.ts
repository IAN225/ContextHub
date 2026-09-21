import { attachmentFromReference } from '../../attachments/content.ts';
import type { Attachment } from '../../core/model.ts';
import { record, string, type ParsedConversation } from '../contracts.ts';
import { chatgptFileId } from '../parsers/chatgpt-assets.ts';
import { readLimitedBody } from './http.ts';

/** Resolve public share assets only; no account cookies or login credentials. */
export async function resolveChatGPTAssets(
  parsed: ParsedConversation,
  shareId: string,
  fetcher: typeof fetch,
) {
  const pending = parsed.messages
    .flatMap((m) => m.attachments ?? [])
    .filter((a) => a.status === 'missing' && chatgptFileId(a.reference ?? ''));
  const resolved = new Map<string, Attachment>();
  const files = [...new Set(pending.map((a) => a.reference!))];
  const signal = AbortSignal.timeout(15000);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, files.length) }, async () => {
      while (next < files.length) {
        const index = next++,
          file = files[index];
        const original = pending.find((a) => a.reference === file)!;
        let response: Response | undefined;
        try {
          if (index >= 30 || signal.aborted)
            throw new Error('图片地址未能在本次导入中获取，可稍后重新导入。');
          const query = new URLSearchParams({
            shared_conversation_id: shareId,
          });
          response = await fetcher(
            `https://chatgpt.com/backend-anon/files/download/${encodeURIComponent(file)}?${query}`,
            {
              redirect: 'manual',
              signal,
              headers: { Accept: 'application/json' },
            },
          );
          if ([401, 403, 429].includes(response.status))
            throw new Error(
              'ChatGPT 未允许服务器读取此分享图片。可下载原图后在原文编辑中补充。',
            );
          if (!response.ok)
            throw new Error('分享图片暂时不可获取，可稍后重新导入。');
          const data = record(
            JSON.parse(await readLimitedBody(response, 64 * 1024)),
          );
          const url = new URL(string(data.download_url));
          if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            !(
              url.hostname === 'chatgpt.com' ||
              /(?:^|\.)oaiusercontent\.com$/.test(url.hostname)
            )
          )
            throw new Error('分享图片未提供受支持的公开下载地址。');
          const media = attachmentFromReference({ ...original, url: url.href });
          resolved.set(file, { ...media, id: original.id });
        } catch (error) {
          resolved.set(file, {
            ...original,
            status: 'failed',
            error:
              error instanceof Error &&
              ![
                'TypeError',
                'TimeoutError',
                'AbortError',
                'SyntaxError',
              ].includes(error.name)
                ? error.message
                : '图片地址获取失败，可稍后重新导入。',
          });
        } finally {
          if (response?.body && !response.bodyUsed)
            await response.body.cancel().catch(() => {});
        }
      }
    }),
  );
  const messages = parsed.messages.map((m) => ({
    ...m,
    ...(m.attachments
      ? {
          attachments: m.attachments.map((a) => {
            const result = resolved.get(a.reference ?? '');
            return result ? { ...result, id: a.id } : a;
          }),
        }
      : {}),
  }));
  const missing = messages.some((m) =>
    m.attachments?.some(
      (a) => !['stored', 'remote'].includes(a.status ?? 'missing'),
    ),
  );
  return {
    ...parsed,
    messages,
    issues: missing
      ? parsed.issues
      : parsed.issues.filter((i) => i.code !== 'MISSING_ASSETS'),
  };
}
