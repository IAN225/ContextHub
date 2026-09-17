type BodyOptions = {
  tooLarge: () => Error;
} & (
  | { signal?: undefined; aborted?: never }
  | { signal?: AbortSignal; aborted: () => Error }
);

// Limits count wire bytes, not characters. Adapters retain their protocol errors.
export async function readTextBody(
  response: Response | Request,
  limit: number,
  options: BodyOptions,
) {
  if (options.signal?.aborted) throw options.aborted!();
  if (Number(response.headers.get('content-length')) > limit)
    throw options.tooLarge();
  const reader = response.body?.getReader();
  if (!reader) return '';
  let cancel: (() => void) | undefined;
  const aborted =
    options.signal &&
    new Promise<never>((_, reject) => {
      cancel = () => {
        // Reject before cancellation can settle a pending read as EOF.
        reject(options.aborted!());
        void reader.cancel().catch(() => {});
      };
      options.signal!.addEventListener('abort', cancel, { once: true });
      if (options.signal!.aborted) cancel();
    });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await (aborted
        ? Promise.race([reader.read(), aborted])
        : reader.read());
      if (options.signal?.aborted) throw options.aborted!();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw options.tooLarge();
      chunks.push(value);
    }
  } finally {
    if (cancel) options.signal?.removeEventListener('abort', cancel);
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

// Drain rejected requests so the local proxy can reuse its wire connection.
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
