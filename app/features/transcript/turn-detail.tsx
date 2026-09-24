'use client';
import { Archive, Pencil, Code2, RotateCcw, Trash2 } from 'lucide-react';
import { ConversationMessages } from '../../components/shared/conversation-messages.tsx';
import { TurnDivider } from '../../components/shared/turn-divider.tsx';
import { Button } from '../../components/shared/button.tsx';
import { Segments } from '../../components/shared/segments.tsx';
import {
  type Status,
  type Turn,
  type Workspace,
} from '../../lib/core/model.ts';
import type { TurnCoverageMark } from './timeline.tsx';
export function TurnDetail({
  current,
  appearance,
  actual,
  previousId,
  mark,
  tab,
  setTab,
  rendered,
  setRendered,
  onEdit,
  onInsert,
  onStatus: status,
}: {
  current: Turn;
  appearance?: Workspace['appearance'];
  actual: number;
  previousId: string | null;
  mark: TurnCoverageMark;
  tab: string;
  setTab: (tab: string) => void;
  rendered: boolean;
  setRendered: (rendered: boolean) => void;
  onEdit: (turn: Turn) => void;
  onInsert: (after: string | null) => void;
  onStatus: (status: Status) => void;
}) {
  return (
    <div className="turn-detail">
      <div className="detail-tabs">
        <Segments
          value={tab}
          onChange={setTab}
          options={[
            { id: 'preview', label: 'Preview' },
            { id: 'payload', label: 'Payload' },
            { id: 'metadata', label: '元数据' },
          ]}
        />
        <div className="detail-view-options">
          <button
            className="icon-button"
            aria-label="编辑原文"
            title="编辑原文"
            onClick={() => onEdit(current)}
          >
            <Pencil size={16} />
          </button>
          {tab === 'preview' &&
            current.messages.some((m) => m.role === 'assistant') && (
              <button
                className="render-toggle"
                aria-label={rendered ? '显示原始文本' : '显示 Markdown'}
                title={rendered ? '显示原始文本' : '显示 Markdown'}
                aria-pressed={rendered}
                onClick={() => setRendered(!rendered)}
              >
                <Code2 size={16} />
              </button>
            )}
        </div>
      </div>
      {tab === 'preview' ? (
        <div className="conversation-text">
          <TurnDivider number={actual} />
          <ConversationMessages
            turn={current}
            appearance={appearance}
            rendered={rendered}
          />
        </div>
      ) : tab === 'payload' ? (
        <pre className="payload">
          {JSON.stringify(
            {
              id: current.id,
              messages: current.messages,
              attachments: current.attachments?.map(({ url: _url, ...a }) => a),
              timestamp: current.time,
            },
            null,
            2,
          )}
        </pre>
      ) : (
        <div className="metadata-grid">
          {Object.entries({
            轮次: actual,
            '轮次 ID': current.id,
            覆盖状态: {
              recent: '近期原文',
              covered: '已纳入摘要',
              gap: '记忆缺口',
              pending: '待压缩原文',
            }[mark],
            来源: current.source,
            原始时间: current.time ?? '未提供',
            Token: current.tokens ?? '来源未提供',
            'Cache 命中': current.cache ?? '来源未提供',
            附件: current.attachments?.length ?? 0,
            内容边界: '当前 user 至下一条 user 前',
            删除时间: current.deletedAt ?? '未删除',
          }).map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="detail-footer" role="group" aria-label="轮次操作">
        <Button
          aria-label="在此轮之前插入"
          onClick={() => onInsert(previousId)}
        >
          {'<· 插入'}
        </Button>
        <Button
          onClick={() =>
            status(current.status === 'normal' ? 'deprecated' : 'normal')
          }
        >
          {current.status === 'normal' ? (
            <Archive size={14} />
          ) : (
            <RotateCcw size={14} />
          )}
          {current.status === 'normal' ? '弃用' : '恢复'}
        </Button>
        {current.status !== 'trash' && (
          <Button
            aria-label="删除此轮（移入回收站）"
            onClick={() => status('trash')}
          >
            <Trash2 size={14} />
            删除
          </Button>
        )}
        <Button
          className="turn-insert-after"
          aria-label="在此轮之后插入"
          onClick={() => onInsert(current.id)}
        >
          {'插入 ·>'}
        </Button>
      </div>
      {current.status === 'trash' && (
        <p className="callout">
          回收站按完整轮次保留。删除满 30
          天后，会在工作区打开时清理；清理前可以恢复。
        </p>
      )}
    </div>
  );
}
