'use client';
import { ConversationMessages } from '../../components/shared/conversation-messages.tsx';
import { TurnDivider } from '../../components/shared/turn-divider.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';
import { type Turn } from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
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
        const userIndex = Math.max(
          0,
          t.messages.findIndex((m) => m.role === 'user'),
        );
        return (
          <div className="upload-turn" key={t.id}>
            <TurnDivider number={i + 1} />
            <ConversationMessages
              turn={t}
              headerExtra={(indices) =>
                indices.includes(userIndex) && (
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
                )
              }
            />
          </div>
        );
      })}
    </div>
  );
}
