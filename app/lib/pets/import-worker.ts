import { importPetPack } from './package';
import { readImageDataUrl } from './images';
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const pack = importPetPack(new Uint8Array(event.data));
    for (const animation of Object.values(pack.animations))
      for (const frame of animation.frames) {
        const { bytes, mime } = readImageDataUrl(frame.src);
        const bitmap = await createImageBitmap(
          new Blob([bytes as BlobPart], { type: mime }),
        );
        const valid =
          bitmap.width === frame.width && bitmap.height === frame.height;
        bitmap.close();
        if (!valid) throw Error('图片尺寸校验失败。');
      }
    self.postMessage({ pack });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : '角色包读取失败。',
    });
  }
};
