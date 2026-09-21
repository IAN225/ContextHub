export const SHARE_MAX_BYTES = 8 * 1024 * 1024;
export const SHARE_BROWSER_TIMEOUT_MS = 25000;
export const SHARE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function claudeSnapshotUrl(id: string) {
  if (!SHARE_ID.test(id)) throw new Error('Invalid share ID');
  return `https://claude.ai/api/chat_snapshots/${id}?rendering_mode=messages&render_all_tools=true`;
}
export const browserErrors = {
  BROWSER_BUSY: '正在读取另一条分享，请稍后重试。',
  BROWSER_UNAVAILABLE:
    '浏览器导入服务不可用，请管理员检查 Chromium 与 Xvfb 安装。',
  SOURCE_TIMEOUT: '读取分享超时，请稍后重试。',
  SOURCE_READ_FAILED: '暂时无法读取分享，请稍后重试。',
  TOO_LARGE: '分享数据超过 8 MiB 上限。',
} as const;
