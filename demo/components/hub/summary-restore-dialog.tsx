'use client';
import { useState } from 'react';
import { Layers, Check } from 'lucide-react';
import { Button, Modal, ChainMap } from './shared';
import {
  coverage,
  restoreSummary,
  type Workspace,
  type Summary,
} from '@/lib/domain';
export function RestoreDialog({
  w,
  summary,
  onApply,
  onClose,
}: {
  w: Workspace;
  summary: Summary;
  onApply: (mode: 'keep' | 'rewind') => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'keep' | 'rewind'>('rewind');
  const preview = restoreSummary(
    {
      ...w,
      summaries: w.summaries.some((s) => s.id === summary.id)
        ? w.summaries
        : [...w.summaries, summary],
    },
    summary.id,
    mode,
  );
  const c = coverage(preview);
  return (
    <Modal
      title="选择摘要，也选择如何继续"
      description="活跃摘要与原文处理水位独立。回退不会删除任何原文。"
      onClose={onClose}
    >
      <div className="selected-summary">
        <Layers size={18} />
        <span>{summary.title}</span>
        <span className="pill">覆盖 {summary.covered.length} 轮</span>
      </div>
      <label className={`radio-choice ${mode === 'rewind' ? 'selected' : ''}`}>
        <input
          type="radio"
          name="restore"
          checked={mode === 'rewind'}
          onChange={() => setMode('rewind')}
        />
        <div>
          <strong>原文窗口跟随回退，重新压缩</strong>
          <p>
            把处理水位移到这份摘要对应的原文之后。从这里重新处理，直到近期窗口到达末尾。点击应用后，由你开始压缩。
          </p>
        </div>
      </label>
      <label className={`radio-choice ${mode === 'keep' ? 'selected' : ''}`}>
        <input
          type="radio"
          name="restore"
          checked={mode === 'keep'}
          onChange={() => setMode('keep')}
        />
        <div>
          <strong>保留已有处理进度，允许中间缺口</strong>
          <p>
            保留当前水位，只处理水位之后的新内容。中间没有被选中摘要覆盖的原文，会明确标记为「不在摘要内」。
          </p>
        </div>
      </label>
      <div className="surface">
        <div className="surface-head">
          <h2>应用后的覆盖状态</h2>
          <small>
            {c.gap.length
              ? `${c.gap.length} 轮不在记忆中`
              : `${c.pending.length} 轮待重新压缩`}
          </small>
        </div>
        <ChainMap w={preview} />
      </div>
      {c.gap.length > 0 && (
        <p className="callout warning">
          缺口原文仍保存在仓库，可以查看和搜索，但默认记忆包不会包含这部分内容。
        </p>
      )}
      <div className="form-actions">
        <Button onClick={onClose}>取消</Button>
        <Button primary onClick={() => onApply(mode)}>
          <Check size={15} />
          应用此摘要
        </Button>
      </div>
    </Modal>
  );
}
