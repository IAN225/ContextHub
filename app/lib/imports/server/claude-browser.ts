import { ImportError } from '../contracts.ts';
import {
  browserErrors,
  SHARE_BROWSER_TIMEOUT_MS,
  SHARE_ID,
} from '../share-transport.ts';

export async function readClaudeSnapshot(
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const address = process.env.CONTEXT_HUB_SHARE_BROWSER_URL;
  const key = process.env.CONTEXT_HUB_SHARE_BROWSER_KEY;
  if (!SHARE_ID.test(id) || !address || !key)
    throw new ImportError(
      'BROWSER_UNAVAILABLE',
      browserErrors.BROWSER_UNAVAILABLE,
      503,
    );
  const url = new URL(address);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password
  )
    throw new ImportError(
      'BROWSER_UNAVAILABLE',
      browserErrors.BROWSER_UNAVAILABLE,
      503,
    );
  let response: Response;
  try {
    response = await fetcher(url.href, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
      body: id,
      signal: AbortSignal.timeout(SHARE_BROWSER_TIMEOUT_MS + 5000),
    });
  } catch {
    throw new ImportError(
      'BROWSER_UNAVAILABLE',
      browserErrors.BROWSER_UNAVAILABLE,
      503,
    );
  }
  const error = response.headers.get('x-context-hub-browser-error');
  if (
    error ||
    ([401, 404, 503].includes(response.status) &&
      !response.headers.has('x-context-hub-browser-response'))
  ) {
    await response.body?.cancel().catch(() => {});
    const code =
      error && Object.hasOwn(browserErrors, error)
        ? (error as keyof typeof browserErrors)
        : 'BROWSER_UNAVAILABLE';
    throw new ImportError(
      code,
      browserErrors[code],
      code === 'TOO_LARGE' ? 413 : code === 'SOURCE_TIMEOUT' ? 504 : 503,
    );
  }
  return response;
}
