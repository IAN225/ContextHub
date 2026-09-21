'use client';
import {
  ChevronRight,
  Clock,
  History,
  Layers,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { Empty } from '../../components/shared/empty.tsx';
import { Markdown } from '../../components/shared/markdown.tsx';
import type { Summary, WorkspaceContext } from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import type { SendWorkspaceCommand } from '../../lib/state/contracts.ts';
import { RestoreDialog } from './restore-dialog.tsx';
import { SummaryWorkbench } from './workbench.tsx';
export function SummaryHistory({
  w,
  onCommand,
  beforeChange,
  workbench,
  emptyDetail = '先导入原文，再配置模型并开始压缩。',
}: {
  w: WorkspaceContext;
  onCommand: SendWorkspaceCommand;
  beforeChange?: () => void;
  workbench?: { pendingCount: number; onReview: () => void };
  emptyDetail?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [restore, setRestore] = useState<Summary | null>(null);
  const s =
    w.summaries.find((s) => s.id === selected) ??
    w.summaries.find((s) => s.id === w.activeId);
  return (
    <>
      <div className="summary-layout">
        <aside className="checkpoint-list">
          <div className="surface-head">
            <h2>
              <History size={15} />
              检查点
            </h2>
            <small>{w.summaries.length} / 30</small>
          </div>
          <div className="checkpoint-scroll">
            {[...w.summaries].reverse().map((item, i) => (
              <button
                className={!creating && s?.id === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => {
                  setCreating(false);
                  setSelected(item.id);
                }}
              >
                <div className="checkpoint-marker">
                  <span />
                  {i !== w.summaries.length - 1 && <i />}
                </div>
                <div>
                  <div className="checkpoint-title">
                    {item.title}
                    {item.id === w.activeId && (
                      <span className="pill">活跃</span>
                    )}
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
              每次保存一个检查点，最多保留 30
              条。选择历史摘要后，可单独决定是否回退原文水位。
            </p>
          </div>
          {workbench && (
            <button
              type="button"
              className={`checkpoint-create ${creating ? 'selected' : ''}`}
              aria-pressed={creating}
              onClick={() => {
                beforeChange?.();
                setCreating(true);
              }}
            >
              <Plus size={17} />
              <span>新建自定义摘要</span>
            </button>
          )}
        </aside>
        <article className="summary-paper">
          {creating && workbench ? (
            <SummaryWorkbench
              w={w}
              pendingCount={workbench.pendingCount}
              onReview={workbench.onReview}
            />
          ) : s ? (
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
            <Empty title="还没有摘要" detail={emptyDetail} />
          )}
        </article>
      </div>
      {restore && (
        <RestoreDialog
          w={w}
          summary={restore}
          onClose={() => setRestore(null)}
          onApply={(mode) => {
            beforeChange?.();
            onCommand({ type: 'summary/restore', summaryId: restore.id, mode });
            setSelected(restore.id);
            setRestore(null);
          }}
        />
      )}
    </>
  );
}
