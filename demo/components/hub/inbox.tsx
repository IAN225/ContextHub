'use client';
import { PageTitle } from './shared';
import { UploadReview, type UploadReviewProps } from './upload-review';
export function InboxPage(props: UploadReviewProps) {
  return (
    <>
      <div className="section-heading compact">
        <PageTitle>收件箱</PageTitle>
        <span className="muted-label">对话 API 投递</span>
      </div>
      <p className="inbox-description">
        只接收第三方客户端通过对话 API 发来的上下文，确认后归档到手账。
      </p>
      <UploadReview {...props} delivery />
    </>
  );
}
