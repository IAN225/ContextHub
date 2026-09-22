'use client';
import type { ReactNode } from 'react';
import { Code2 } from 'lucide-react';
import type { Turn, Workspace } from '../../lib/core/model.ts';
import { messageMedia } from '../../lib/attachments/message-media.ts';
import {
  conversationGroups,
  isToolMessage,
} from '../../lib/conversation/presentation.ts';
import { AttachmentCard } from './attachment-card.tsx';
import { Markdown } from './markdown.tsx';
import { ModelAvatar } from './model-avatar.tsx';
import { UserMessageOrnament } from './user-message-ornament.tsx';

/** Shared reading layout for archived transcripts and incoming conversations. */
export function ConversationMessages({
  turn,
  appearance,
  rendered = false,
  headerExtra,
}: {
  turn: Turn;
  appearance?: Workspace['appearance'];
  rendered?: boolean;
  headerExtra?: (indices: readonly number[]) => ReactNode;
}) {
  const media = messageMedia(turn);
  return (
    <>
      {conversationGroups(media.messages).map(({ role, indices }) => (
        <div
          className={`message conversation-role ${role}`}
          data-role={role}
          key={indices[0]}
        >
          {role === 'user' && <UserMessageOrnament />}
          <div className="message-avatar">
            {role === 'user' ? (
              '我'
            ) : role === 'assistant' ? (
              <ModelAvatar value={appearance?.avatar} />
            ) : (
              <Code2 size={16} />
            )}
          </div>
          <div className="message-heading">
            <span className="message-label">
              {role === 'user'
                ? 'You'
                : role === 'assistant'
                  ? 'Assistant'
                  : (media.messages[indices[0]].name ?? role)}
            </span>
            {headerExtra?.(indices)}
          </div>
          <div className="message-body">
            {indices.map((index) => {
              const m = media.messages[index];
              const tool = isToolMessage(m.role);
              return (
                <div
                  className={tool ? 'conversation-tool' : 'conversation-part'}
                  data-role={m.role}
                  data-message-index={index}
                  key={index}
                >
                  {tool && (
                    <div className="conversation-tool-label">
                      <Code2 size={14} aria-hidden="true" />
                      <span>
                        {m.role === 'tool_result' || m.role === 'tool'
                          ? '工具结果'
                          : '工具调用'}
                        {m.name ? ` · ${m.name}` : ''}
                      </span>
                    </div>
                  )}
                  {m.content &&
                    (rendered && m.role === 'assistant' ? (
                      <Markdown text={m.content} />
                    ) : (
                      <p className={`raw-text ${tool ? 'tool-text' : ''}`}>
                        {m.content}
                      </p>
                    ))}
                  <div className="message-attachments">
                    {media.byMessage[index].map((a) => (
                      <AttachmentCard attachment={a} key={a.id} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {media.unassigned.map((a) => (
        <AttachmentCard attachment={a} key={a.id} />
      ))}
    </>
  );
}
