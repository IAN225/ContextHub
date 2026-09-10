'use client';
import Image from 'next/image';
import { useState } from 'react';
import { Paperclip, Download, RotateCcw } from 'lucide-react';
import type { Attachment } from '@/lib/domain';
import { attachmentLabels, attachmentStatus } from '@/lib/attachments';
import { useTaskQueue } from '@/lib/tasks/use-background-tasks';
import { Button } from './shared';
export function AttachmentCard({ attachment: a }: { attachment: Attachment }) {
  const queue = useTaskQueue();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [brokenImage, setBrokenImage] = useState(false);
  const status = attachmentStatus(a);
  const stored = status === 'stored' && a.url.startsWith('data:');
  async function retry() {
    if (!queue) return;
    setBusy(true);
    setError('');
    try {
      await queue.startAttachment(a);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '附件任务未能入队。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachment-card">
      {stored &&
      /^image\/(png|jpeg|gif|webp|avif)$/i.test(a.type) &&
      !brokenImage ? (
        <Image
          unoptimized
          src={a.url}
          alt={a.name}
          width={180}
          height={140}
          style={{ objectFit: 'contain' }}
          onError={() => setBrokenImage(true)}
        />
      ) : (
        <Paperclip size={20} />
      )}
      <div className="attachment-card-details">
        <strong>{a.name}</strong>
        <span>
          {attachmentLabels[status]}
          {a.size !== undefined ? ` · ${(a.size / 1024).toFixed(1)} KB` : ''}
        </span>
        {a.error && <p>{a.error}</p>}
        {brokenImage && <p>图片无法预览，原文件仍可下载。</p>}
        {a.text ? (
          <details>
            <summary>查看附件文字</summary>
            <pre className="raw-text">{a.text}</pre>
          </details>
        ) : (
          stored && <small>原文件已保存，尚未提取正文。</small>
        )}
        <div className="action-row">
          {stored && (
            <a href={a.url} download={a.name}>
              <Download size={13} />
              下载
            </a>
          )}
          {!stored && /^https:\/\//i.test(a.sourceUrl || a.url) && queue && (
            <Button
              disabled={busy || !queue.ready}
              onClick={() => {
                void retry();
              }}
            >
              <RotateCcw size={13} />
              {busy
                ? '正在入队…'
                : status === 'failed'
                  ? '重试获取'
                  : '获取附件'}
            </Button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  );
}
