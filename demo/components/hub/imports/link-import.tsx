'use client';
import { Link2 } from 'lucide-react';
import { Button } from '../shared';

export function LinkImport({
  link,
  onLink,
  onSubmit,
  busy,
  disabled,
}: {
  link: string;
  onLink: (link: string) => void;
  onSubmit: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <div className="form-stack">
      <label className="field">
        ChatGPT / Claude 公开分享链接
        <input
          aria-label="分享链接"
          value={link}
          onChange={(e) => onLink(e.target.value)}
          placeholder="https://chatgpt.com/share/… 或 https://claude.ai/share/…"
        />
      </label>
      <p className="inline-note">
        读取公开对话后放入收件箱，可在那里查看原文和选择手账归档。链接失效或站点限制访问时会说明原因；未取得的附件会保留缺失标记。
      </p>
      <Button
        primary
        disabled={disabled || busy || !link.trim()}
        onClick={onSubmit}
      >
        <Link2 size={15} />
        {busy ? '正在读取分享…' : '导入收件箱'}
      </Button>
    </div>
  );
}
