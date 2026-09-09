'use client';
import { PageTitle } from './shared';
import { UploadReview, type UploadReviewProps } from './upload-review';
export function InboxPage(props: UploadReviewProps) {
  return (
    <>
      <div className="section-heading compact">
        <PageTitle>收件箱</PageTitle>
        <span className="muted-label">分享链接 · 客户端投递</span>
      </div>
      <p className="inbox-description">
        分享链接和客户端投递的对话统一收在这里，查看后选择手账归档。
      </p>
      <UploadReview {...props} delivery />
    </>
  );
}
