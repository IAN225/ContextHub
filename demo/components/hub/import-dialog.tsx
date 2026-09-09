'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Segments, SaveStatus } from './shared';
import { usePersistent } from '@/lib/store';
import type { Upload } from '@/lib/domain';
import { importManual } from '@/lib/imports/manual';
import { importRequest } from '@/lib/imports/client';
import { emptyImportDraft, normalizeImportDraft } from '@/lib/imports/draft';
import { ManualImport } from './imports/manual-import';
import { LinkImport } from './imports/link-import';
import { DeliverySettings } from './imports/delivery-settings';

export function ImportDialog({
  onUpload,
  onClose,
  pendingCount,
  onReview,
  onDeliveryEnabled,
}: {
  onUpload: (u: Upload) => Promise<boolean>;
  onClose: () => void;
  pendingCount: number;
  onReview: () => void;
  onDeliveryEnabled: () => Promise<boolean>;
}) {
  const [draft, setDraft, persistence] = usePersistent(
    'import-draft-v1',
    {
      ...emptyImportDraft,
    },
    { normalize: normalizeImportDraft },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const tab = ['manual', 'link', 'api'].includes(draft.tab)
    ? draft.tab
    : 'manual';
  const set = (patch: Partial<typeof draft>) =>
    setDraft({ ...draft, ...patch });
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    request.current = controller;
    try {
      const upload =
        tab === 'manual'
          ? importManual(draft.text, draft.title, draft.format || 'auto')
          : (
              await importRequest<{ upload: Upload }>(
                'share',
                { link: draft.link, title: draft.title },
                controller.signal,
              )
            ).upload;
      if (
        !controller.signal.aborted &&
        !(await onUpload(upload)) &&
        mounted.current
      )
        setError(
          tab === 'link'
            ? '未能保存到收件箱，请重试。链接仍在。'
            : '未能保存导入预览，请重试。输入内容仍在。',
        );
    } catch (e) {
      if (!controller.signal.aborted && mounted.current)
        setError(e instanceof Error ? e.message : '导入失败，请重试。');
    } finally {
      if (mounted.current && request.current === controller) setBusy(false);
    }
  }
  return (
    <Modal
      title="收录对话"
      description={
        tab === 'api'
          ? '接收客户端发送的上下文，确认后归档。'
          : tab === 'link'
            ? '读取分享内容后放入收件箱，随时查看和归档。'
            : '导入后先预览完整轮次，再选择归档到哪本手账。'
      }
      onClose={onClose}
    >
      <Segments
        value={tab}
        onChange={(tab) => {
          request.current?.abort();
          setBusy(false);
          set({ tab });
          setError('');
        }}
        options={[
          { id: 'manual', label: '手动复制' },
          { id: 'link', label: '分享链接' },
          { id: 'api', label: '客户端投递' },
        ]}
      />
      {tab !== 'api' && (
        <div className="form-stack">
          {tab === 'manual' && pendingCount > 0 && (
            <Button onClick={onReview}>
              继续确认手动导入（{pendingCount}）
            </Button>
          )}
          <label className="field">
            导入标题
            <input
              aria-label="导入标题"
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="留空时使用对话内容命名"
            />
          </label>
        </div>
      )}
      {tab === 'manual' ? (
        <ManualImport
          text={draft.text}
          format={draft.format || 'auto'}
          onText={(text) => set({ text, json: '' })}
          onFormat={(format) => set({ format })}
          onSubmit={() => {
            void submit();
          }}
          disabled={!persistence.ready || busy}
        />
      ) : tab === 'link' ? (
        <LinkImport
          link={draft.link}
          onLink={(link) => set({ link })}
          onSubmit={() => {
            void submit();
          }}
          disabled={!persistence.ready}
          busy={busy}
        />
      ) : (
        <DeliverySettings
          protocol={draft.protocol}
          onProtocol={(protocol) => set({ protocol })}
          onActivate={onDeliveryEnabled}
        />
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <span className="save-caption">
        <SaveStatus state={persistence}>
          {persistence.saved ? '✓ 导入草稿已保存' : '正在保存草稿…'}
        </SaveStatus>
      </span>
    </Modal>
  );
}
