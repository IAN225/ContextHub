export const workspaceTones = {
  sage: '鼠尾草',
  blue: '雾蓝',
  rose: '玫瑰',
  sand: '暖沙',
} as const;
export const modelAvatars = {
  sparkles: '星光',
  bot: '机器人',
  message: '对话',
  orbit: '轨道',
} as const;
export type WorkspaceAppearance = {
  tone?: keyof typeof workspaceTones;
  avatar?: keyof typeof modelAvatars;
};
export function validAppearance(value: unknown): value is WorkspaceAppearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.tone === undefined ||
      (typeof v.tone === 'string' && Object.hasOwn(workspaceTones, v.tone))) &&
    (v.avatar === undefined ||
      (typeof v.avatar === 'string' && Object.hasOwn(modelAvatars, v.avatar)))
  );
}
