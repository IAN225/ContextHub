import {
  object,
  petLimits,
  normalizeSourceName,
  type PetPack,
  type PetAnimation,
} from './contracts.ts';
import { imageInfo, imageDataUrl } from './images.ts';
import { readPetZip, safePetPath } from './zip.ts';
import { normalizePetPreferences } from './package.ts';

// Layout metadata verified against Codex desktop 26.908.9136.0 (v1/v2).
export const codexLayouts = {
  1: { width: 1536, height: 1872, rows: 9 },
  2: { width: 1536, height: 2288, rows: 11 },
} as const;
export const compatibleZipBytes = 24 * 1024 * 1024;
const sheetBytes = 20 * 1024 * 1024;
export type PetCrop = { x: number; y: number; width: number; height: number };
export type CropPetFrames = (
  bytes: Uint8Array,
  rectangles: PetCrop[],
) => Promise<Uint8Array[]>;
const tracks = [
  {
    state: 'idle',
    row: 0,
    durations: [1680, 660, 660, 840, 840, 1920],
    fps: 1,
  },
  { state: 'drag', row: 7, durations: [120, 120, 120, 120, 120, 220], fps: 8 },
  { state: 'mail', row: 3, durations: [140, 140, 140, 280], fps: 6 },
] as const;
export async function importCompatiblePetPack(
  zip: Uint8Array,
  crop: CropPetFrames,
): Promise<PetPack> {
  const files = readPetZip(zip, {
    ...petLimits,
    zipBytes: compatibleZipBytes,
    expandedBytes: 24 * 1024 * 1024,
    imageBytes: sheetBytes,
  });
  const manifests = [...files.keys()].filter(
    (p) => p === 'pet.json' || p.endsWith('/pet.json'),
  );
  if (manifests.length !== 1) throw Error('ZIP 中需要且只能有一个 pet.json。');
  const manifest = manifests[0],
    base = manifest.slice(0, -8),
    config = object(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(files.get(manifest)!),
      ),
    );
  if (config.schemaVersion !== undefined || config.animations !== undefined)
    throw Error('请使用 Codex 图集模板：pet.json 和 spritesheet.png / webp。');
  const version = config.spriteVersionNumber ?? 1;
  if (version !== 1 && version !== 2)
    throw Error('仅支持 Codex spriteVersionNumber 1 或 2。');
  const path = config.spritesheetPath ?? 'spritesheet.webp';
  if (typeof path !== 'string')
    throw Error('spritesheetPath 需要填写包内图片路径。');
  const bytes = files.get(base + safePetPath(path));
  if (!bytes) throw Error('找不到 Codex 图集文件。');
  const info = imageInfo(bytes, { bytes: sheetBytes, dimension: 2288 }),
    layout = codexLayouts[version];
  if (info.width !== layout.width || info.height !== layout.height)
    throw Error(
      'Codex v' +
        version +
        ' 图集尺寸应为 ' +
        layout.width +
        ' × ' +
        layout.height +
        '。',
    );
  if (
    !path.toLowerCase().endsWith(info.mime === 'image/png' ? '.png' : '.webp')
  )
    throw Error('图集扩展名与图片内容不匹配。');
  const rectangles = tracks.flatMap((track) =>
    track.durations.map((_, column) => ({
      x: column * 192,
      y: track.row * 208,
      width: 192,
      height: 208,
    })),
  );
  const images = await crop(bytes, rectangles);
  if (images.length !== rectangles.length) throw Error('图集拆帧失败。');
  let offset = 0;
  const animations = {} as PetPack['animations'];
  for (const track of tracks) {
    const frames = images
      .slice(offset, offset + track.durations.length)
      .map((bytes) => {
        const frame = imageInfo(bytes);
        if (frame.width !== 192 || frame.height !== 208)
          throw Error('图集帧尺寸无效。');
        return {
          src: imageDataUrl(bytes, frame.mime),
          width: 192,
          height: 208,
        };
      });
    offset += frames.length;
    animations[track.state] = {
      frames,
      fps: track.fps,
      loop: true,
      durationsMs: [...track.durations],
    } satisfies PetAnimation;
  }
  const rawName =
    config.displayName ??
    config.id ??
    (base ? base.split('/').filter(Boolean).at(-1) : 'Codex 桌宠');
  const pack: PetPack = {
    schemaVersion: 1,
    name: normalizeSourceName(rawName),
    source: version === 1 ? 'codex-v1' : 'codex-v2',
    animations,
  };
  return normalizePetPreferences({
    schemaVersion: 1,
    active: 'custom',
    custom: pack,
  }).custom!;
}
