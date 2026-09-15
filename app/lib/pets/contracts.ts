export const petStates = ['idle', 'drag', 'mail'] as const;
export type PetState = (typeof petStates)[number];
export const petStateLabels: Record<PetState, string> = {
  idle: '默认',
  drag: '按住 / 拖动',
  mail: '待处理收件',
};
export type PetFrame = { src: string; width: number; height: number };
export type PetAnimation = {
  frames: PetFrame[];
  fps: number;
  loop: boolean;
  durationsMs?: number[];
};
export type PetPack = {
  schemaVersion: 1;
  name: string;
  source?: 'codex-v1' | 'codex-v2';
  animations: { idle: PetAnimation; drag?: PetAnimation; mail?: PetAnimation };
};
export type PetPreferences = {
  schemaVersion: 1;
  active: 'builtin' | 'custom';
  custom: PetPack | null;
};
export const PET_PREFERENCES_KEY = 'pet-preferences-v1';
export const defaultPetPreferences: PetPreferences = {
  schemaVersion: 1,
  active: 'builtin',
  custom: null,
};
export const petLimits = {
  zipBytes: 12 * 1024 * 1024,
  expandedBytes: 16 * 1024 * 1024,
  imageBytes: 2 * 1024 * 1024,
  files: 256,
  frames: 240,
  dimension: 512,
  pixels: 8 * 1024 * 1024,
};
export function petState(
  pressed: boolean,
  dragging: boolean,
  unread: number,
): PetState {
  return pressed || dragging ? 'drag' : unread > 0 ? 'mail' : 'idle';
}
export function petAnimation(pack: PetPack, state: PetState): PetAnimation {
  return pack.animations[state] ?? pack.animations.idle;
}
export function frameIndex(animation: PetAnimation, elapsedMs: number) {
  if (animation.durationsMs) {
    const total = animation.durationsMs.reduce((sum, n) => sum + n, 0);
    let elapsed = Math.max(0, elapsedMs);
    if (!animation.loop && elapsed >= total) return animation.frames.length - 1;
    elapsed %= total;
    for (let i = 0; i < animation.durationsMs.length; i++) {
      if (elapsed < animation.durationsMs[i]) return i;
      elapsed -= animation.durationsMs[i];
    }
    return animation.frames.length - 1;
  }
  const index = Math.floor((Math.max(0, elapsedMs) * animation.fps) / 1000);
  return animation.loop
    ? index % animation.frames.length
    : Math.min(index, animation.frames.length - 1);
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('角色包格式无效。');
  return value as Record<string, unknown>;
}
export function animationOptions(value: unknown) {
  const a = object(value);
  if (
    !Number.isFinite(a.fps) ||
    Number(a.fps) < 1 ||
    Number(a.fps) > 30 ||
    typeof a.loop !== 'boolean'
  )
    throw Error('动画 fps 应为 1–30，loop 应为 true 或 false。');
  if (
    a.durationsMs !== undefined &&
    (!Array.isArray(a.durationsMs) ||
      !a.durationsMs.length ||
      a.durationsMs.length > petLimits.frames ||
      a.durationsMs.some((n) => !Number.isFinite(n) || n < 16 || n > 10000))
  )
    throw Error('动画帧时长无效。');
  return {
    fps: Number(a.fps),
    loop: a.loop,
    ...(a.durationsMs === undefined
      ? {}
      : { durationsMs: a.durationsMs as number[] }),
  };
}

export function normalizeSourceName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw Error('桌宠名称无效。');
  return value.trim().slice(0, 60);
}
