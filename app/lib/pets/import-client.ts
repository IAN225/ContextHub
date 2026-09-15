import { petLimits, type PetPack } from './contracts';
export async function readPetFile(
  file: File,
  signal: AbortSignal,
): Promise<PetPack> {
  if (file.size > petLimits.zipBytes) throw Error('ZIP 不能超过 12 MB。');
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const bytes = await file.arrayBuffer();
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.ts', import.meta.url), {
      type: 'module',
    });
    let done = false;
    const finish = (error?: Error, pack?: PetPack) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      worker.terminate();
      if (error) reject(error);
      else resolve(pack!);
    };
    const cancel = () => finish(new DOMException('已取消', 'AbortError'));
    const timer = setTimeout(
      () => finish(Error('角色包处理超时，请减少图片数量或尺寸。')),
      30000,
    );
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (event) => {
      const value = event.data as { error?: string; pack?: PetPack };
      if (value.error || !value.pack)
        finish(Error(value.error || '角色包读取失败。'));
      else finish(undefined, value.pack);
    };
    worker.onerror = () =>
      finish(Error('图片解码失败，请检查角色包或使用较新的浏览器。'));
    worker.postMessage(bytes, [bytes]);
  });
}
