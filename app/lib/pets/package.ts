import {
  animationOptions,
  object,
  petLimits,
  petStates,
  type PetPack,
  type PetPreferences,
  type PetAnimation,
} from './contracts.ts';
import { imageInfo, imageDataUrl, readImageDataUrl } from './images.ts';
import { readPetZip, safePetPath } from './zip.ts';
function packName(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 60)
    throw Error('请在 pet.json 中填写 1–60 字的名称。');
  return raw.trim();
}
export function importPetPack(zip: Uint8Array): PetPack {
  const files = readPetZip(zip);
  const manifests = [...files.keys()].filter(
    (p) => p === 'pet.json' || p.endsWith('/pet.json'),
  );
  if (manifests.length !== 1) throw Error('ZIP 中需要且只能有一个 pet.json。');
  const manifest = manifests[0],
    base = manifest.slice(0, -8);
  const data = object(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(files.get(manifest)!),
    ),
  );
  if (data.schemaVersion !== 1)
    throw Error('角色包版本不支持，请使用版本 1 模板。');
  const animations = object(data.animations);
  if (!animations.idle) throw Error('角色包需要 idle 默认动画。');
  const result: Partial<Record<(typeof petStates)[number], PetAnimation>> = {};
  let count = 0,
    pixels = 0,
    bytes = 0;
  for (const state of petStates) {
    if (animations[state] === undefined) continue;
    const config = object(animations[state]),
      options = animationOptions(config);
    if (typeof config.directory !== 'string')
      throw Error('动画需要 directory 图片目录。');
    const directory = safePetPath(config.directory.replace(/\/$/, ''));
    const prefix = base + directory + '/';
    const names = [...files.keys()]
      .filter(
        (name) =>
          name.startsWith(prefix) &&
          !name.slice(prefix.length).includes('/') &&
          /\.(png|webp)$/i.test(name),
      )
      .sort(
        (a, b) =>
          a.localeCompare(b, 'en', { numeric: true }) ||
          a.localeCompare(b, 'en'),
      );
    if (!names.length) {
      if (state === 'idle') throw Error('idle 目录没有 PNG / WebP 帧。');
      continue;
    }
    if ((count += names.length) > petLimits.frames)
      throw Error('动画合计不能超过 240 帧。');
    const frames = names.map((name) => {
      const value = files.get(name)!,
        info = imageInfo(value);
      if (
        !name
          .toLowerCase()
          .endsWith(info.mime === 'image/png' ? '.png' : '.webp')
      )
        throw Error('图片扩展名与内容不匹配。');
      pixels += info.width * info.height;
      bytes += value.length;
      if (pixels > petLimits.pixels || bytes > petLimits.expandedBytes)
        throw Error('素材总量过大，请减少帧数或缩小图片。');
      return {
        src: imageDataUrl(value, info.mime),
        width: info.width,
        height: info.height,
      };
    });
    if (options.durationsMs && options.durationsMs.length !== frames.length)
      throw Error('动画帧时长数量不匹配。');
    result[state] = { ...options, frames };
  }
  return {
    schemaVersion: 1,
    name: packName(data.name),
    animations: result as PetPack['animations'],
  };
}
export function normalizePetPreferences(raw: unknown): PetPreferences {
  const value = object(raw);
  if (
    value.schemaVersion !== 1 ||
    (value.active !== 'builtin' && value.active !== 'custom')
  )
    throw Error('桌宠设置版本无效。');
  if (value.custom === null) {
    if (value.active === 'custom') throw Error('自定义角色包缺失。');
    return value as PetPreferences;
  }
  const pack = object(value.custom);
  if (
    pack.source !== undefined &&
    pack.source !== 'codex-v1' &&
    pack.source !== 'codex-v2'
  )
    throw Error('角色包来源格式无效。');
  if (pack.schemaVersion !== 1) throw Error('角色包版本无效。');
  const animations = object(pack.animations);
  if (!animations.idle) throw Error('默认动画缺失。');
  const result: Partial<Record<(typeof petStates)[number], PetAnimation>> = {};
  let count = 0,
    pixels = 0,
    bytes = 0,
    changed = false;
  for (const state of petStates) {
    if (animations[state] === undefined) continue;
    const animation = object(animations[state]),
      options = animationOptions(animation);
    if (
      !Array.isArray(animation.frames) ||
      !animation.frames.length ||
      (count += animation.frames.length) > petLimits.frames
    )
      throw Error('动画帧数量无效。');
    if (
      options.durationsMs &&
      options.durationsMs.length !== animation.frames.length
    )
      throw Error('动画帧时长数量不匹配。');
    result[state] = {
      ...options,
      frames: animation.frames.map((raw) => {
        const frame = object(raw),
          info = readImageDataUrl(frame.src);
        if (frame.width !== info.width || frame.height !== info.height)
          changed = true;
        pixels += info.width * info.height;
        bytes += info.bytes.length;
        if (pixels > petLimits.pixels || bytes > petLimits.expandedBytes)
          throw Error('角色包过大。');
        return {
          src: String(frame.src),
          width: info.width,
          height: info.height,
        };
      }),
    };
  }
  if (!changed && packName(pack.name) === pack.name)
    return value as PetPreferences;
  return {
    schemaVersion: 1,
    active: value.active as PetPreferences['active'],
    custom: {
      schemaVersion: 1,
      name: packName(pack.name),
      ...(pack.source ? { source: pack.source as PetPack['source'] } : {}),
      animations: result as PetPack['animations'],
    },
  };
}
