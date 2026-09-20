'use client';
import { AlertTriangle, Check, Pause, Play, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { ChainMap } from '../../components/shared/coverage-map.tsx';
import { PageTitle } from '../../components/shared/page-title.tsx';
import { Picker } from '../../components/shared/picker.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { type WorkspaceContext } from '../../lib/core/model.ts';
import { type SendWorkspaceCommand } from '../../lib/state/contracts.ts';
import { estimateInput } from '../../lib/summary/contracts.ts';
import { coverage } from '../../lib/summary/coverage.ts';
import { engineLabels } from '../../lib/summary/engines.ts';
import { selectCompressionBatch } from '../../lib/summary/planning.ts';
import type { CommitWorkspaceCommand } from '../../lib/application/use-hub.ts';
import { SummaryHistory } from './history.tsx';
import { RetentionControl } from './retention-control.tsx';
import { ModelSettings } from './model-settings.tsx';
import { useSummaryTask } from './use-summary-task.ts';
export function SummaryEnginePage({
  w,
  onCommand,
  onCommit,
  onRefresh,
  pendingCount,
  onReview,
}: {
  w: WorkspaceContext;
  onRefresh: () => Promise<void>;
  onCommand: SendWorkspaceCommand;
  onCommit: CommitWorkspaceCommand;
  pendingCount: number;
  onReview: () => void;
}) {
  const [modal, setModal] = useState('');
  const task = useSummaryTask(w);
  const { running, message } = task;
  const c = coverage(w);
  const batchTokenMode = w.config.batchMode === 'tokens';
  let batchPreview: ReturnType<typeof selectCompressionBatch> | undefined;
  try {
    batchPreview = selectCompressionBatch(w, c);
  } catch {
    // Invalid imported model settings remain editable in the settings dialog.
  }
  const batchTokens = batchPreview?.input
    ? estimateInput(batchPreview.input.system, batchPreview.input.user)
    : 0;
  return (
    <>
      <div className="section-heading compact">
        <div>
          <PageTitle>{engineLabels[w.summaryEngine ?? 'custom']}</PageTitle>
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
          <RetentionControl
            w={w}
            onCommand={onCommand}
            beforeChange={() => task.stop()}
          />
          <fieldset className="summary-limit" aria-label="每批发送上限">
            <legend>每批发送上限</legend>
            <input
              aria-label={batchTokenMode ? '每批 token 上限' : '每批轮次数'}
              className={batchTokenMode ? 'token-limit-input' : ''}
              type="number"
              min={1}
              max={batchTokenMode ? 2000000 : 100}
              value={
                batchTokenMode
                  ? (w.config.batchTokens ?? 16000)
                  : w.config.batch
              }
              onChange={(e) => {
                task.stop();
                const value = Math.max(
                  1,
                  Math.min(
                    batchTokenMode ? 2000000 : 100,
                    Math.floor(Number(e.target.value)) || 1,
                  ),
                );
                onCommand({
                  type: 'summary/config',
                  patch: batchTokenMode
                    ? { batchTokens: value }
                    : { batch: value },
                });
              }}
            />
            <Picker
              label="每批发送单位"
              value={w.config.batchMode ?? 'turns'}
              onChange={(mode) => {
                task.stop();
                onCommand({
                  type: 'summary/config',
                  patch: { batchMode: mode as 'turns' | 'tokens' },
                });
              }}
              options={[
                { value: 'tokens', label: 'token' },
                { value: 'turns', label: '轮' },
              ]}
            />
            <span
              className="summary-limit-hint"
              title="根据下一批完整请求保守估算，包含提示词、已有摘要和原文，并受模型上下文预算限制。"
            >
              估算：约
              {batchTokenMode
                ? (batchPreview?.batch.length ?? 0)
                : batchTokens.toLocaleString()}
              {batchTokenMode ? '轮' : ' token'}
            </span>
          </fieldset>
          <div className="summary-compress-action">
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
          <span>服务运行期间，关闭网页也会继续；新结果会在打开时接收</span>
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
      <SummaryHistory
        w={w}
        onCommand={onCommand}
        beforeChange={() => task.stop()}
        workbench={
          w.summaryEngine === 'custom' || !w.summaryEngine
            ? { pendingCount, onReview }
            : undefined
        }
      />
      {modal === 'settings' && (
        <ModelSettings
          w={w}
          onRefresh={onRefresh}
          onCommit={onCommit}
          onClose={() => setModal('')}
        />
      )}{' '}
    </>
  );
}
