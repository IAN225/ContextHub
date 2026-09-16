import {
  animationOptions,
  object,
  petLimits,
  petStates,
  type PetAnimation,
  type PetPack,
  type PetPreferences,
} from './contracts.ts';
import { readImageDataUrl } from './images.ts';
function packName(raw: unknown) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > 60)
    throw Error('请在 pet.json 中填写 1–60 字的名称。');
  return raw.trim();
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
