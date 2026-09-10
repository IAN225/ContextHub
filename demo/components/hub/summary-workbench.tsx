'use client';
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button, Picker, SaveStatus } from './shared';
import { TextEditor } from './editors';
import { usePersistent } from '@/lib/store';
import { type Workspace } from '@/lib/domain';
import { useTaskQueue } from '@/lib/tasks/use-background-tasks';
import { planWorkbench } from '@/lib/summary/planning';
export function SummaryWorkbench({
  w,
  pendingCount,
  onReview,
}: {
  w: Workspace;
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
  const [queued, setQueued] = useState(false);
  const queue = useTaskQueue();
  const running = queue?.tasks.some(
    (t) =>
      t.kind === 'workbench' &&
      t.workspace_id === w.id &&
      ['queued', 'running', 'pausing'].includes(t.status),
  );
  async function generate() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (!queue?.ready) throw new Error('请先启动本地后台服务。');
      planWorkbench(w, selected, s, d.instruction);
      await queue.startWorkbench(
        w,
        selected.map((t) => t.id),
        s?.id ?? '',
        d.instruction,
      );
      setQueued(true);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '候选任务未能入队。',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="summary-custom-editor">
      <div className="summary-paper-head">
        <div>
          <div className="eyebrow">CUSTOM SUMMARY</div>
          <h2>新建自定义摘要</h2>
          <p>选择历史摘要和重点原文，生成候选后确认应用。</p>
        </div>
        <FlaskConical size={22} />
      </div>
      {(queued || running) && (
        <p className="callout">
          候选生成任务已加入后台，可以切换到其他页面。结果接收后会显示在待确认候选中。
        </p>
      )}
      {pendingCount > 0 && (
        <div className="workbench-pending">
          <Button
            onClick={() => {
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
          label="自定义摘要起始摘要"
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
            running ||
            !queue?.ready ||
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
            ? '正在加入后台…'
            : running
              ? '后台正在生成…'
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
    </div>
  );
}
