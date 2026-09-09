'use client';
import { useMemo, useState } from 'react';
import {
  Search,
  ArrowUpRight,
  MessageSquare,
  Layers,
  StickyNote,
} from 'lucide-react';
import { usePersistent } from '@/lib/store';
import {
  Modal,
  PageTitle,
  Markdown,
  Empty,
  Picker,
  SaveStatus,
} from './shared';
import type { Workspace } from '@/lib/domain';
import { createMemorySearch } from '@/lib/memory-search';
export function SearchPage({
  workspaces,
}: {
  workspaces: Workspace[];
  currentId: string;
}) {
  const [d, setD, persistence] = usePersistent('search-draft', {
      query: '',
      scope: 'all',
      kind: 'all',
      limit: '20',
    }),
    [selected, setSelected] = useState<{
      title: string;
      text: string;
      kind: string;
      workspace: string;
    } | null>(null);
  const [search] = useState(createMemorySearch);
  const hits = useMemo(
    () =>
      search(workspaces, {
        query: d.query,
        scope: d.scope,
        kind: d.kind,
        limit: Number(d.limit),
      }),
    [search, workspaces, d.query, d.scope, d.kind, d.limit],
  );
  return (
    <>
      <div className="section-heading compact">
        <div>
          <PageTitle>搜索记忆</PageTitle>
        </div>
      </div>
      <div className="journal-search-input">
        <Search size={20} />
        <input
          value={d.query}
          onChange={(e) => setD({ ...d, query: e.target.value })}
          placeholder="试试「交流方式」「散步」或「阅读」"
          aria-label="搜索所有记忆"
        />
      </div>
      <div className="search-options">
        <Picker
          label="搜索范围"
          value={d.scope}
          onChange={(scope) => setD({ ...d, scope })}
          options={[
            { value: 'all', label: '所有手账' },
            ...workspaces.map((w) => ({ value: w.id, label: w.name })),
          ]}
        />
        <Picker
          label="搜索内容类型"
          value={d.kind}
          onChange={(kind) => setD({ ...d, kind })}
          options={[
            { value: 'all', label: '所有内容' },
            { value: 'turn', label: '完整原文轮次' },
            { value: 'summary', label: '摘要' },
            { value: 'note', label: 'Note' },
          ]}
        />
        <Picker
          label="返回数量"
          value={d.limit}
          onChange={(limit) => setD({ ...d, limit })}
          options={['10', '20', '50'].map((v) => ({
            value: v,
            label: `最多 ${v} 条`,
          }))}
        />
      </div>
      <div className="surface-head">
        {persistence.error && (
          <SaveStatus state={persistence}>{null}</SaveStatus>
        )}
        <span className="muted-label">
          {d.query.trim() ? `找到 ${hits.total} 条相关记忆` : '请输入关键词'}
        </span>
        <small>本地关键词检索 · 不调用向量模型</small>
      </div>
      <div className="search-results">
        {hits.items.map((x) => (
          <button
            key={`${x.workspaceId}-${x.kind}-${x.id}`}
            onClick={() => setSelected(x)}
          >
            <span className="search-result-icon">
              {x.kind === 'turn' ? (
                <MessageSquare size={17} />
              ) : x.kind === 'summary' ? (
                <Layers size={17} />
              ) : (
                <StickyNote size={17} />
              )}
            </span>
            <div>
              <small>
                {x.workspace} ·{' '}
                {x.kind === 'turn'
                  ? '完整轮次'
                  : x.kind === 'summary'
                    ? '摘要'
                    : 'Note'}
              </small>
              <h3>{x.title}</h3>
              <p>
                {x.text.slice(
                  Math.max(
                    0,
                    x.text.toLowerCase().indexOf(d.query.trim().toLowerCase()) -
                      35,
                  ),
                  Math.max(
                    0,
                    x.text.toLowerCase().indexOf(d.query.trim().toLowerCase()) -
                      35,
                  ) + 190,
                )}
              </p>
            </div>
            <ArrowUpRight size={15} />
          </button>
        ))}
      </div>
      {d.query && !hits.total && (
        <Empty
          title="这一页暂时没找到"
          detail="可以换一个关键词，或扩大到所有手账。弃用和回收站内容不参与搜索。"
        />
      )}
      {selected && (
        <Modal
          title={selected.title}
          description={`${selected.workspace} · ${selected.kind === 'turn' ? '返回完整轮次，保留工具消息' : '记忆全文'}`}
          onClose={() => setSelected(null)}
        >
          <Markdown text={selected.text} />
        </Modal>
      )}
    </>
  );
}
