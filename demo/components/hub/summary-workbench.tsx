'use client';
import { FlaskConical } from 'lucide-react';
import { Button, Modal, Picker, SaveStatus } from './shared';
import { TextEditor } from './editors';
import { usePersistent } from '@/lib/store';
import { uid, now, type Workspace, type Upload } from '@/lib/domain';
export function SummaryWorkbench({
  w,
  onCreate,
  onClose,
  pendingCount,
  onReview,
}: {
  w: Workspace;
  onCreate: (u: Upload) => void;
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
  return (
    <Modal
      title="摘要工作台"
      description="选择历史摘要和重点原文生成候选，预览确认后再设为活跃摘要。"
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
            !p.ready ||
            d.from < 1 ||
            d.to < d.from ||
            d.to > w.turns.length ||
            !w.config.configured
          }
          onClick={() => {
            onCreate({
              id: uid(),
              title: '工作台候选摘要',
              kind: 'summary',
              channel: 'workbench',
              source: '摘要工作台 · 模拟生成',
              turns: [],
              workspaceId: w.id,
              covered: [
                ...new Set([
                  ...(s?.covered ?? []),
                  ...selected.map((t) => t.id),
                ]),
              ],
              summaryText: [
                s?.text ?? '',
                `\n## 整理要求\n${d.instruction}`,
                `\n## 重点原文（演示摘录）\n${selected.map((t) => `- ${t.messages.find((m) => m.role === 'user')?.content}`).join('\n')}`,
              ].join('\n'),
              createdAt: now(),
            });
            onClose();
          }}
        >
          <FlaskConical size={15} />
          生成候选并预览（模拟）
        </Button>
      </div>
      {!w.config.configured && (
        <p className="inline-note">请先配置演示摘要模型。</p>
      )}
    </Modal>
  );
}
