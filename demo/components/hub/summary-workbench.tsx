'use client';
import { useEffect, useRef, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button, Modal, Picker, SaveStatus } from './shared';
import { TextEditor } from './editors';
import { usePersistent } from '@/lib/store';
import { uid, now, type Workspace, type Upload } from '@/lib/domain';
import { requestSummary } from '@/lib/summary/client';
import { planWorkbench } from '@/lib/summary/planning';
export function SummaryWorkbench({
  w,
  onCreate,
  onClose,
  pendingCount,
  onReview,
}: {
  w: Workspace;
  onCreate: (u: Upload) => Promise<boolean>;
  onClose: () => void;
  pendingCount: number;
  onReview: () => void;
}) {
  const [d, setD, p] = usePersistent(`workbench-${w.id}`, {
    summaryId: w.activeId ?? '',
    from: Math.max(1, w.turns.length - 7),
    to: w.turns.length,
    instruction: '重点保留交流偏好，以及最近正在讨论的话题。',
  });
  const s = w.summaries.find((s) => s.id === d.summaryId),
    selected = w.turns
      .slice(Math.max(0, d.from - 1), d.to)
      .filter((t) => t.status === 'normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<Upload | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function generate() {
    if (busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      let upload = candidate;
      if (!upload) {
        const plan = planWorkbench(w, selected, s, d.instruction);
        const result = await requestSummary(plan.input, controller.signal);
        if (controller.signal.aborted) return;
        upload = {
          id: uid(),
          title: '工作台候选摘要',
          kind: 'summary',
          channel: 'workbench',
          source: `摘要工作台 · ${result.model}`,
          turns: [],
          workspaceId: w.id,
          covered: plan.covered,
          summaryText: result.text,
          createdAt: now(),
        };
        setCandidate(upload);
      }
      if (await onCreate(upload)) onClose();
      else setError('候选已生成，但保存失败。点击重试保存，不会再次调用模型。');
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : '候选摘要生成失败。',
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <Modal
      title="摘要工作台"
      description="选择历史摘要和重点原文调用模型生成候选，预览确认后再设为活跃摘要。"
      onClose={onClose}
    >
      {pendingCount > 0 && (
        <div className="workbench-pending">
          <Button
            onClick={() => {
              onClose();
              onReview();
            }}
          >
            查看待确认候选（{pendingCount}）
          </Button>
        </div>
      )}
      <label className="field">
        起始摘要
        <Picker
          label="工作台起始摘要"
          value={d.summaryId}
          onChange={(summaryId) => setD({ ...d, summaryId })}
          options={[
            { value: '', label: '不使用已有摘要' },
            ...w.summaries.map((s) => ({
              value: s.id,
              label: `${s.title} · ${s.covered.length} 轮`,
            })),
          ]}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          加入原文 · 从第几轮
          <input
            type="number"
            min={1}
            max={w.turns.length}
            value={d.from}
            onChange={(e) => setD({ ...d, from: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          至第几轮（包含）
          <input
            type="number"
            min={d.from}
            max={w.turns.length}
            value={d.to}
            onChange={(e) => setD({ ...d, to: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="callout">
        已选择 {selected.length}{' '}
        个正常状态的完整轮次。工具调用与结果随对应轮次一起加入。
      </p>
      <TextEditor
        label="想重点保留什么"
        value={d.instruction}
        onChange={(instruction) => setD({ ...d, instruction })}
      />
      <div className="form-actions">
        <span className="save-caption">
          <SaveStatus state={p}>
            {p.saved ? '✓ 草稿已保存' : '正在保存…'}
          </SaveStatus>
        </span>
        <Button
          primary
          disabled={
            busy ||
            !p.ready ||
            !Number.isInteger(d.from) ||
            !Number.isInteger(d.to) ||
            d.from < 1 ||
            d.to < d.from ||
            d.to > w.turns.length ||
            !w.config.configured ||
            !w.config.modelEnabled
          }
          onClick={() => {
            void generate();
          }}
        >
          <FlaskConical size={15} />
          {busy
            ? '正在生成并保存…'
            : candidate
              ? '重试保存候选'
              : '生成候选并预览'}
        </Button>
      </div>
      {(!w.config.configured || !w.config.modelEnabled) && (
        <p className="inline-note">请先配置摘要模型。</p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {candidate && error && (
        <label className="field">
          尚未保存的候选
          <textarea readOnly rows={6} value={candidate.summaryText} />
        </label>
      )}
    </Modal>
  );
}
