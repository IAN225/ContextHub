'use client';
import { Mail, MailOpen } from 'lucide-react';
import type { NoteNotification } from '@/lib/hub-state';
import { Button, PageTitle, formatDate } from './shared';
import { UploadReview, type UploadReviewProps } from './upload-review';
export function InboxPage({
  notifications,
  onRead,
  ...props
}: UploadReviewProps & {
  notifications: NoteNotification[];
  onRead: (id: string) => void;
}) {
  return (
    <>
      <div className="section-heading compact">
        <PageTitle>收件箱</PageTitle>
        <span className="muted-label">分享链接 · 客户端投递 · Note 通知</span>
      </div>
      <p className="inbox-description">
        分享链接和客户端投递的对话可选择手账归档，模型创建 Note
        的通知也会收在这里。
      </p>
      {notifications.length > 0 && (
        <section className="note-notifications" aria-label="Note 创建通知">
          <div className="surface-head">
            <h2>Note 通知</h2>
            <small>
              {notifications.filter((item) => !item.read).length} 封未读
            </small>
          </div>
          {notifications.map((item) => (
            <article
              key={item.id}
              className={`note-notification${item.read ? ' is-read' : ''}`}
            >
              {item.read ? (
                <MailOpen size={20} aria-hidden="true" />
              ) : (
                <Mail size={20} aria-hidden="true" />
              )}
              <div className="note-notification-content">
                <h3>{item.title}</h3>
                <p>
                  {item.clientName || '模型'} 在工作区「{item.workspaceName}
                  」创建了 Note「{item.title}」。
                </p>
                <small>
                  {formatDate(item.createdAt)} · {item.read ? '已读' : '未读'}
                </small>
              </div>
              {!item.read && (
                <Button onClick={() => onRead(item.id)}>标为已读</Button>
              )}
            </article>
          ))}
        </section>
      )}
      {(props.uploads.length > 0 || notifications.length === 0) && (
        <UploadReview {...props} delivery />
      )}
    </>
  );
}
