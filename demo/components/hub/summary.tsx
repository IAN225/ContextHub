'use client';
import { useState } from 'react';
import {
  Layers,
  Play,
  Pause,
  RotateCcw,
  Settings2,
  Check,
  Clock,
  ChevronRight,
  SlidersHorizontal,
  History,
  AlertTriangle,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Button,
  PageTitle,
  Markdown,
  ChainMap,
  formatDate,
  Empty,
} from './shared';
import type { SendWorkspaceCommand } from '@/lib/hub-state';
import type { CommitWorkspaceCommand } from '@/lib/use-hub';
import { useSummaryTask } from './use-summary-task';
import { RestoreDialog } from './summary-restore-dialog';
import { ModelSettings } from './summary-model-settings';
import { SummaryWorkbench } from './summary-workbench';
import {
  coverage,
  type Workspace,
  type Summary,
  type Upload,
} from '@/lib/domain';
export function SummaryPage({
  w,
  active,
  onCommand,
  onCommit,
  onUpload,
  pendingCount,
  onReview,
}: {
  w: Workspace;
  active: boolean;
  onCommand: SendWorkspaceCommand;
  onCommit: CommitWorkspaceCommand;
  onUpload: (u: Upload) => Promise<boolean>;
  pendingCount: number;
  onReview: () => void;
}) {
  const [selected, setSelected] = useState(w.activeId),
    [modal, setModal] = useState(''),
    [restore, setRestore] = useState<Summary | null>(null);
  const task = useSummaryTask(w, active, onCommand, onCommit, setSelected);
  const { running, message } = task;
  const c = coverage(w),
    s = w.summaries.find((s) => s.id === selected) ?? c.active;
  return (
    <>
      <div className="section-heading compact">
        <div>
          <PageTitle>记忆摘要</PageTitle>
        </div>
        <Button
          onClick={() => {
            task.stop();
            setModal('settings');
          }}
        >
          <Settings2 size={15} />
          摘要设置
        </Button>
      </div>
      <div className="summary-overview">
        <div className="archive-top">
          <span className="section-kicker">记忆覆盖状态</span>
          <span className="pill">
            {running
              ? '压缩中'
              : c.pending.length
                ? `${c.pending.length} 轮待压缩`
                : '已到达保留窗口'}
          </span>
        </div>
        <ChainMap w={w} />
        <div className="summary-controls">
          <label>
            保留近期{' '}
            <input
              aria-label="保留近期轮次数"
              type="number"
              min={1}
              max={500}
              value={w.retain}
              onChange={(e) =>
                onCommand({
                  type: 'summary/retain',
                  retain: Math.max(1, Math.min(500, Number(e.target.value))),
                })
              }
            />{' '}
            轮原文
          </label>
          <label>
            每批最多{' '}
            <input
              aria-label="每批轮次数"
              type="number"
              min={1}
              max={100}
              value={w.config.batch}
              onChange={(e) =>
                onCommand({
                  type: 'summary/config',
                  patch: {
                    batch: Math.max(1, Math.min(100, Number(e.target.value))),
                  },
                })
              }
            />{' '}
            轮
          </label>
          <div className="action-row">
            <Button
              onClick={() => {
                task.stop();
                setModal('workbench');
              }}
            >
              <SlidersHorizontal size={14} />
              工作台
            </Button>
            <Button
              primary
              disabled={
                (!running &&
                  (!w.config.configured ||
                    !w.config.modelEnabled ||
                    !c.pending.length)) ||
                !!task.unsaved ||
                task.saving
              }
              onClick={() => task.toggle()}
            >
              {running ? <Pause size={14} /> : <Play size={14} />}{' '}
              {running ? '暂停' : !w.started ? '开始首次压缩' : '继续压缩'}
            </Button>
          </div>
        </div>
        <div className="summary-switches">
          <label className="checks">
            <Switch
              checked={w.config.review}
              onCheckedChange={(review) => {
                if (review) task.stop();
                onCommand({ type: 'summary/config', patch: { review } });
              }}
            />
            每批生成后暂停检查
          </label>
          <label className="checks">
            <Switch
              checked={w.config.auto}
              disabled={!(w.firstComplete ?? w.started) || w.config.review}
              onCheckedChange={(auto) =>
                onCommand({ type: 'summary/config', patch: { auto } })
              }
            />
            后续自动压缩
          </label>
          <span>本机服务运行期间，关闭网页也会继续；新结果会在打开时接收</span>
        </div>
        {(!w.config.configured || !w.config.modelEnabled) && (
          <p className="callout">
            首次压缩需要先配置摘要模型，然后手动点击开始。
          </p>
        )}
        {message && (
          <p className="callout">
            <Check size={14} />
            {message}
          </p>
        )}
        {c.gap.length > 0 && (
          <p className="callout warning">
            <AlertTriangle size={14} />有 {c.gap.length}{' '}
            轮原文不在摘要与近期窗口内。原文仍可搜索，默认记忆包不包含这些内容。
          </p>
        )}
      </div>
      {task.error && (
        <p className="callout warning" role="alert">
          {task.error}
        </p>
      )}
      {task.unsaved && (
        <div className="summary-unsaved">
          <label className="field">
            尚未应用的生成结果
            <textarea readOnly value={task.unsaved.summary.text} rows={6} />
          </label>
          <div className="action-row">
            <Button
              disabled={task.saving}
              onClick={() => {
                task.retrySave();
              }}
            >
              重试保存检查点
            </Button>
            <Button disabled={task.saving} onClick={() => task.discardResult()}>
              放弃此结果
            </Button>
          </div>
        </div>
      )}
      <div className="summary-layout">
        <aside className="checkpoint-list">
          <div className="surface-head">
            <h2>
              <History size={15} />
              检查点
            </h2>
            <small>{w.summaries.length} / 30</small>
          </div>
          {[...w.summaries].reverse().map((item, i) => (
            <button
              className={s?.id === item.id ? 'selected' : ''}
              key={item.id}
              onClick={() => setSelected(item.id)}
            >
              <div className="checkpoint-marker">
                <span />
                {i !== w.summaries.length - 1 && <i />}
              </div>
              <div>
                <div className="checkpoint-title">
                  {item.title}
                  {item.id === w.activeId && <span className="pill">活跃</span>}
                </div>
                <p>覆盖 {item.covered.length} 轮原文</p>
                <small>{formatDate(item.createdAt)}</small>
              </div>
              <ChevronRight size={13} />
            </button>
          ))}
          {!w.summaries.length && (
            <p className="inline-note">首次压缩后，检查点会出现在这里。</p>
          )}
          <p className="inline-note checkpoint-help">
            每批保存一个检查点，最多保留 30
            条。选择历史摘要后，可单独决定是否回退原文水位。
          </p>
        </aside>
        <article className="summary-paper">
          {s ? (
            <>
              <div className="summary-paper-head">
                <div>
                  <div className="eyebrow">
                    {s.id === w.activeId
                      ? 'ACTIVE SUMMARY'
                      : 'HISTORY CHECKPOINT'}
                  </div>
                  <h2>{s.title}</h2>
                  <p>
                    覆盖 {s.covered.length} 轮 · {formatDate(s.createdAt)}
                  </p>
                </div>
                <Layers size={22} />
              </div>
              <Markdown text={s.text} />
              <div className="summary-paper-footer">
                <span>
                  <Clock size={12} />
                  原文完整保存在仓库
                </span>
                <Button onClick={() => setRestore(s)}>
                  <RotateCcw size={14} />
                  {s.id === w.activeId ? '调整处理水位' : '设为活跃摘要'}
                </Button>
              </div>
            </>
          ) : (
            <Empty
              title="还没有摘要"
              detail="先导入一些原文，再配置模型并开始首次整理。"
            />
          )}
        </article>
      </div>
      <p className="inline-note demo-disclaimer">
        每批调用已配置的模型。仅完整结果保存成功后推进水位；中断或失败不会用摘录代替摘要。
      </p>
      {modal === 'settings' && (
        <ModelSettings w={w} onCommit={onCommit} onClose={() => setModal('')} />
      )}{' '}
      {modal === 'workbench' && (
        <SummaryWorkbench
          w={w}
          onCreate={onUpload}
          onClose={() => setModal('')}
          pendingCount={pendingCount}
          onReview={onReview}
        />
      )}{' '}
      {restore && (
        <RestoreDialog
          w={w}
          summary={restore}
          onClose={() => setRestore(null)}
          onApply={(mode) => {
            task.stop('活跃摘要与处理水位已更新。');
            onCommand({ type: 'summary/restore', summaryId: restore.id, mode });
            setSelected(restore.id);
            setRestore(null);
          }}
        />
      )}
    </>
  );
}
