import { petLimits } from './contracts.ts';
function word(data: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}
export function imageInfo(
  bytes: Uint8Array,
  limits = { bytes: petLimits.imageBytes, dimension: petLimits.dimension },
) {
  if (bytes.length > limits.bytes) throw Error('单张图片不能超过 2 MB。');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    mime = '';
  if (
    bytes.length >= 33 &&
    bytes[0] === 137 &&
    word(bytes, 1, 7) === 'PNG\r\n\x1a\n'
  ) {
    mime = 'image/png';
    if (word(bytes, 12, 4) !== 'IHDR' || v.getUint32(8) !== 13)
      throw Error('PNG 文件头无效。');
    width = v.getUint32(16);
    height = v.getUint32(20);
    let end = false;
    for (let p = 8; p + 12 <= bytes.length;) {
      const size = v.getUint32(p),
        type = word(bytes, p + 4, 4);
      if (p + 12 + size > bytes.length) throw Error('PNG 文件不完整。');
      if (type === 'acTL') throw Error('请将动画拆成独立 PNG 或 WebP 帧。');
      if (type === 'IEND') {
        end = true;
        break;
      }
      p += 12 + size;
    }
    if (!end) throw Error('PNG 文件不完整。');
  } else if (
    bytes.length >= 30 &&
    word(bytes, 0, 4) === 'RIFF' &&
    word(bytes, 8, 4) === 'WEBP'
  ) {
    mime = 'image/webp';
    if (v.getUint32(4, true) + 8 !== bytes.length)
      throw Error('WebP 文件不完整。');
    for (let p = 12; p + 8 <= bytes.length;) {
      const type = word(bytes, p, 4),
        size = v.getUint32(p + 4, true),
        q = p + 8;
      if (q + size > bytes.length) throw Error('WebP 文件不完整。');
      if (type === 'ANIM' || type === 'ANMF')
        throw Error('请将动画拆成独立 PNG 或 WebP 帧。');
      if (type === 'VP8X' && size >= 10) {
        if (bytes[q] & 2) throw Error('请使用静态 WebP 帧。');
        width = 1 + bytes[q + 4] + (bytes[q + 5] << 8) + (bytes[q + 6] << 16);
        height = 1 + bytes[q + 7] + (bytes[q + 8] << 8) + (bytes[q + 9] << 16);
      } else if (type === 'VP8 ' && size >= 10 && !width) {
        if (word(bytes, q + 3, 3) !== '\x9d\x01\x2a')
          throw Error('WebP 帧无效。');
        width = v.getUint16(q + 6, true) & 16383;
        height = v.getUint16(q + 8, true) & 16383;
      } else if (type === 'VP8L' && size >= 5 && !width) {
        if (bytes[q] !== 47) throw Error('WebP 帧无效。');
        const bits = v.getUint32(q + 1, true);
        width = (bits & 16383) + 1;
        height = ((bits >>> 14) & 16383) + 1;
      }
      p = q + size + (size % 2);
    }
  }
  if (
    !mime ||
    width < 1 ||
    height < 1 ||
    width > limits.dimension ||
    height > limits.dimension
  )
    throw Error('图片需为静态 PNG / WebP，尺寸不超过 512 × 512。');
  return { width, height, mime };
}
export function imageDataUrl(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:' + mime + ';base64,' + btoa(binary);
}
export function readImageDataUrl(src: unknown) {
  if (
    typeof src !== 'string' ||
    src.length > Math.ceil((petLimits.imageBytes * 4) / 3) + 64 ||
    !/^data:image\/(png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)
  )
    throw Error('保存的桌宠图片无效。');
  const comma = src.indexOf(',');
  const bytes = Uint8Array.from(atob(src.slice(comma + 1)), (c) =>
    c.charCodeAt(0),
  );
  const info = imageInfo(bytes);
  if (!src.startsWith('data:' + info.mime + ';'))
    throw Error('图片类型不匹配。');
  return { bytes, ...info };
}
