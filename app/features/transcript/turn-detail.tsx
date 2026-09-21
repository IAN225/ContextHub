'use client';
import {
  Archive,
  Pencil,
  ArrowUp,
  ArrowDown,
  Code2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { TurnDivider } from '../../components/shared/turn-divider.tsx';
import { AttachmentCard } from '../../components/shared/attachment-card.tsx';
import { Button } from '../../components/shared/button.tsx';
import { Markdown } from '../../components/shared/markdown.tsx';
import { ModelAvatar } from '../../components/shared/model-avatar.tsx';
import { Segments } from '../../components/shared/segments.tsx';
import {
  type Status,
  type Turn,
  type Workspace,
} from '../../lib/core/model.ts';
import { messageMedia } from '../../lib/attachments/message-media.ts';
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
  const media = messageMedia(current);
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
          {media.messages.map((m, i) => (
            <div className={`message conversation-role ${m.role}`} data-role={m.role} key={i}>
              <div className="message-avatar">
                {m.role === 'user' ? (
                  '我'
                ) : m.role === 'assistant' ? (
                  <ModelAvatar value={appearance?.avatar} />
                ) : (
                  <Code2 size={16} />
                )}
              </div>
              <div className="message-label">
                {m.role === 'user'
                  ? 'You'
                  : m.role === 'assistant'
                    ? 'Assistant'
                    : (m.name ?? m.role)}
              </div>
              <div className="message-body">
                {rendered && m.role === 'assistant' ? (
                  <Markdown text={m.content} />
                ) : (
                  <p
                    className={`raw-text ${m.role.startsWith('tool') ? 'tool-text' : ''}`}
                  >
                    {m.content}
                  </p>
                )}
                <div className="message-attachments">
                  {media.byMessage[i].map((a) => (
                    <AttachmentCard attachment={a} key={a.id} />
                  ))}
                </div>
              </div>
            </div>
          ))}
          {media.unassigned.map((a) => (
            <AttachmentCard attachment={a} key={a.id} />
          ))}
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
      <div className="detail-footer">
        <fieldset className="turn-insert-actions" aria-label="插入轮次">
          <Button
            aria-label="在此轮之前插入"
            onClick={() => onInsert(previousId)}
          >
            <ArrowUp size={14} /> 前面插入
          </Button>
          <Button
            aria-label="在此轮之后插入"
            onClick={() => onInsert(current.id)}
          >
            <ArrowDown size={14} /> 后面插入
          </Button>
        </fieldset>
        <fieldset className="turn-status-actions" aria-label="轮次状态">
          {current.status !== 'normal' && (
            <Button onClick={() => status('normal')}>
              <RotateCcw size={14} />
              恢复
            </Button>
          )}
          {current.status === 'normal' && (
            <Button onClick={() => status('deprecated')}>
              <Archive size={14} />
              弃用
            </Button>
          )}
          {current.status !== 'trash' && (
            <Button onClick={() => status('trash')}>
              <Trash2 size={14} />
              移入回收站
            </Button>
          )}
        </fieldset>
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
