'use client';
import { Trash2 } from 'lucide-react';
import { AttachmentCard } from '../../components/shared/attachment-card.tsx';
import { Button } from '../../components/shared/button.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { type Turn } from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import { messageMedia } from '../../lib/attachments/message-media.ts';
export function UploadTurnPreview({
  turns,
  checked,
  onCheckedChange: setChecked,
  onRemoveChecked,
}: {
  turns: Turn[];
  checked: string[];
  onCheckedChange: (ids: string[]) => void;
  onRemoveChecked: () => void;
}) {
  return (
    <>
      <div className="upload-selection">
        <span>原文预览 · 按完整轮次选择</span>
        <Button disabled={!checked.length} onClick={onRemoveChecked}>
          <Trash2 size={12} />
          删除所选 {checked.length ? `(${checked.length})` : ''}
        </Button>
      </div>
      <div className="upload-turns">
        {turns.map((t, i) => {
          const media = messageMedia(t);
          return (
            <div className="upload-turn" key={t.id}>
              <label className="upload-turn-label">
                <Checkbox
                  aria-label={`选择上传第 ${i + 1} 轮`}
                  checked={checked.includes(t.id)}
                  onCheckedChange={(yes) =>
                    setChecked(
                      yes
                        ? [...checked, t.id]
                        : checked.filter((id) => id !== t.id),
                    )
                  }
                />
                <span>第 {i + 1} 轮</span>
                <span>{t.time ? formatDate(t.time) : ''}</span>
              </label>
              {media.messages.map((m, j) => (
                <div className="upload-message" key={j}>
                  <small>{m.role}</small>
                  <p>{m.content}</p>
                  {media.byMessage[j].map((a) => (
                    <AttachmentCard attachment={a} key={a.id} />
                  ))}
                </div>
              ))}
              {media.unassigned.map((a) => (
                <AttachmentCard attachment={a} key={a.id} />
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
