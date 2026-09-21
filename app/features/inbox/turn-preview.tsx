'use client';
import { AttachmentCard } from '../../components/shared/attachment-card.tsx';
import { TurnDivider } from '../../components/shared/turn-divider.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { type Turn } from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import { messageMedia } from '../../lib/attachments/message-media.ts';
export function UploadTurnPreview({
  turns,
  checked,
  onCheckedChange: setChecked,
}: {
  turns: Turn[];
  checked: string[];
  onCheckedChange: (ids: string[]) => void;
}) {
  return (
    <div className="upload-turns">
      {turns.map((t, i) => {
        const media = messageMedia(t);
        const userIndex = Math.max(
          0,
          media.messages.findIndex((m) => m.role === 'user'),
        );
        return (
          <div className="upload-turn" key={t.id}>
            <TurnDivider number={i + 1} />
            {media.messages.map((m, j) => (
              <div
                className="upload-message conversation-role"
                data-role={m.role}
                key={j}
              >
                <div className="upload-message-head">
                  <small>{m.role}</small>
                  {j === userIndex && (
                    <>
                      <time>{t.time ? formatDate(t.time) : ''}</time>
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
                    </>
                  )}
                </div>
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
  );
}
