import { inflateSync } from 'fflate';
import { petLimits } from './contracts.ts';
const decoder = new TextDecoder('utf-8', { fatal: true });
export function safePetPath(name: string) {
  if (
    !name ||
    name.length > 240 ||
    name.includes('\\') ||
    Array.from(name).some((c) => c.charCodeAt(0) < 32 || c === ':') ||
    name.startsWith('/') ||
    name
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          ['__proto__', 'constructor', 'prototype'].includes(p),
      )
  )
    throw Error('ZIP 内含无效路径。');
  return name;
}
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function readPetZip(bytes: Uint8Array, limits = petLimits) {
  if (bytes.length > limits.zipBytes || bytes.length < 22)
    throw Error('ZIP 文件大小无效。');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    (v.getUint32(end, true) !== 0x06054b50 ||
      end + 22 + v.getUint16(end + 20, true) !== bytes.length)
  )
    end--;
  if (end < 0 || end < bytes.length - 65557) throw Error('ZIP 文件不完整。');
  const count = v.getUint16(end + 10, true),
    start = v.getUint32(end + 16, true),
    size = v.getUint32(end + 12, true);
  if (
    v.getUint16(end + 4, true) ||
    v.getUint16(end + 6, true) ||
    count !== v.getUint16(end + 8, true) ||
    count > petLimits.files ||
    !count ||
    start + size !== end
  )
    throw Error('ZIP 格式不支持或文件过多。');
  let offset = start,
    total = 0;
  const names = new Set<string>();
  const entries = new Map<
    string,
    {
      size: number;
      crc: number;
      directory: boolean;
      start: number;
      compressed: number;
      method: number;
    }
  >();
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || v.getUint32(offset, true) !== 0x02014b50)
      throw Error('ZIP 目录无效。');
    const flags = v.getUint16(offset + 8, true),
      method = v.getUint16(offset + 10, true),
      crc = v.getUint32(offset + 16, true),
      compressed = v.getUint32(offset + 20, true),
      expanded = v.getUint32(offset + 24, true),
      nameSize = v.getUint16(offset + 28, true),
      extra = v.getUint16(offset + 30, true),
      comment = v.getUint16(offset + 32, true),
      local = v.getUint32(offset + 42, true);
    const next = offset + 46 + nameSize + extra + comment;
    if (
      next > end ||
      local + 30 > start ||
      v.getUint16(offset + 34, true) ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      ((v.getUint32(offset + 38, true) >>> 16) & 0xf000) === 0xa000
    )
      throw Error('ZIP 包含不支持的条目。');
    const name = decoder.decode(
        bytes.subarray(offset + 46, offset + 46 + nameSize),
      ),
      directory = name.endsWith('/');
    safePetPath(directory ? name.slice(0, -1) : name);
    const folded = name.toLowerCase();
    if (names.has(folded)) throw Error('ZIP 内有重名文件。');
    names.add(folded);
    if (
      expanded > (name.endsWith('pet.json') ? 16384 : limits.imageBytes) ||
      (total += expanded) > limits.expandedBytes
    )
      throw Error('解压后素材过大。');
    if (
      v.getUint32(local, true) !== 0x04034b50 ||
      v.getUint16(local + 8, true) !== method ||
      v.getUint16(local + 6, true) !== flags
    )
      throw Error('ZIP 文件头不匹配。');
    const localName = v.getUint16(local + 26, true),
      body = local + 30 + localName + v.getUint16(local + 28, true);
    if (
      body + compressed > start ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + localName)) !==
        name
    )
      throw Error('ZIP 条目不完整。');
    if (ranges.some((r) => local < r.end && body + compressed > r.start))
      throw Error('ZIP 条目重叠。');
    ranges.push({ start: local, end: body + compressed });
    if (directory && (expanded || compressed > 2))
      throw Error('ZIP 目录无效。');
    entries.set(name, {
      size: expanded,
      crc,
      directory,
      start: body,
      compressed,
      method,
    });
    offset = next;
  }
  if (offset !== end) throw Error('ZIP 目录无效。');
  const files = new Map<string, Uint8Array>();
  for (const [name, meta] of entries) {
    const compressed = bytes.subarray(meta.start, meta.start + meta.compressed);
    const file =
      meta.method === 0
        ? compressed.slice()
        : inflateSync(compressed, { out: new Uint8Array(meta.size) });
    if (!file || file.length !== meta.size || crc32(file) !== meta.crc)
      throw Error('ZIP 内容校验失败。');
    if (!meta.directory) files.set(name, file);
  }
  return files;
}
