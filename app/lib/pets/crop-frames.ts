import type { CropPetFrames } from './codex';
import { imageInfo } from './images';
export const cropPetFrames: CropPetFrames = async (bytes, rectangles) => {
  const info = imageInfo(bytes, { bytes: 20 * 1024 * 1024, dimension: 2288 });
  const bitmap = await createImageBitmap(
    new Blob([bytes as BlobPart], { type: info.mime }),
  );
  try {
    if (bitmap.width !== info.width || bitmap.height !== info.height)
      throw Error('图集解码尺寸不匹配。');
    const canvas = new OffscreenCanvas(192, 208),
      context = canvas.getContext('2d');
    if (!context) throw Error('浏览器无法处理图集。');
    const frames: Uint8Array[] = [];
    for (const r of rectangles) {
      context.clearRect(0, 0, 192, 208);
      context.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, 192, 208);
      const pixels = context.getImageData(0, 0, 192, 208).data;
      let visible = false;
      for (let i = 3; i < pixels.length; i += 4)
        if (pixels[i] > 0) {
          visible = true;
          break;
        }
      if (!visible)
        throw Error('Codex 图集需要完整的 idle、running 和 waving 动画帧。');
      frames.push(
        new Uint8Array(
          await (
            await canvas.convertToBlob({ type: 'image/png' })
          ).arrayBuffer(),
        ),
      );
    }
    return frames;
  } finally {
    bitmap.close();
  }
};
