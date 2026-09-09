'use client';
import Image from 'next/image';
import {
  ArrowUpRight,
  Plus,
  Code2,
  Clock,
  Archive,
  Trash2,
  RotateCcw,
  Paperclip,
} from 'lucide-react';
import { Button, Segments, Markdown, formatDate } from './shared';
import type { Turn, Status } from '@/lib/domain';
import type { TurnCoverageMark } from './transcript-timeline';
export function TurnDetail({
  current,
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
      <div className="detail-top">
        <div className="turn-badge">{String(actual).padStart(3, '0')}</div>
        <div>
          <h2>{current.title}</h2>
          <div className="metadata-line">
            <span className="platform-dot" />
            {current.source}
            <span>·</span>
            <Clock size={12} />
            {formatDate(current.time)}
            <span>·</span>
            <span className={mark === 'gap' ? 'amber' : 'mint'}>
              {
                {
                  recent: '近期原文 · 将随记忆包返回',
                  covered: '已纳入摘要',
                  gap: '不在摘要内 · 记忆缺口',
                  pending: '待压缩原文',
                }[mark]
              }
            </span>
          </div>
        </div>
        <button
          className="text-button edit-turn"
          onClick={() => onEdit(current)}
        >
          编辑原文 <ArrowUpRight size={14} />
        </button>
      </div>
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
          <span>{current.messages.length} 条消息 · 完整轮次</span>
          {tab === 'preview' &&
            current.messages.some((m) => m.role === 'assistant') && (
              <button
                className="render-toggle"
                aria-label="当前轮次的模型回复使用 Markdown 显示"
                aria-pressed={rendered}
                onClick={() => setRendered(!rendered)}
              >
                {rendered ? '显示原始文本' : '显示 Markdown'}
              </button>
            )}
        </div>
      </div>
      {tab === 'preview' ? (
        <div className="conversation-text">
          {current.messages.map((m, i) => (
            <div className={`message ${m.role}`} key={i}>
              <div className="message-avatar">
                {m.role === 'user' ? (
                  '我'
                ) : m.role === 'assistant' ? (
                  <span className="ai-glyph">✳</span>
                ) : (
                  <Code2 size={16} />
                )}
              </div>
              <div className="message-body">
                <div className="message-label">
                  {m.role === 'user'
                    ? 'You'
                    : m.role === 'assistant'
                      ? 'Assistant'
                      : (m.name ?? m.role)}
                </div>
                {rendered && m.role === 'assistant' ? (
                  <Markdown text={m.content} />
                ) : (
                  <p
                    className={`raw-text ${m.role.startsWith('tool') ? 'tool-text' : ''}`}
                  >
                    {m.content}
                  </p>
                )}
              </div>
            </div>
          ))}
          {current.attachments?.map((a) => (
            <div className="attachment-preview" key={a.id}>
              {a.type.startsWith('image/') ? (
                <Image
                  unoptimized
                  src={a.url}
                  alt={a.name}
                  width={180}
                  height={180}
                  style={{ objectFit: 'contain' }}
                />
              ) : (
                <Paperclip size={20} />
              )}
              <a download={a.name} href={a.url}>
                {a.name}
              </a>
            </div>
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
            '轮次 ID': current.id,
            来源: current.source,
            原始时间: current.time ?? '未知 · 导入源未提供，不推断时间',
            Token: current.tokens ?? '来源未提供',
            'Cache 命中': current.cache ?? '来源未提供',
            附件: current.attachments?.length ?? 0,
            内容边界: '当前 user 至下一条 user 前',
            隐藏思考: '不保存',
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
        <Button onClick={() => onInsert(previousId)}>
          <Plus size={13} /> 在此轮之前插入
        </Button>
        <div>
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
          <Button onClick={() => onInsert(current.id)}>
            <Plus size={13} /> 在此轮之后插入
          </Button>
        </div>
      </div>
      {current.status === 'trash' && (
        <p className="callout">
          回收站按完整轮次保留。正式版将在删除 30 天后清理；本地 demo
          不运行后台清理。
        </p>
      )}
    </div>
  );
}
