'use client';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button, PageTitle, Segments, ChainMap, Empty } from './shared';
import { coverage, type Workspace, type Turn, type Status } from '@/lib/domain';
import type { SendWorkspaceCommand } from '@/lib/hub-state';
import { useTranscriptNavigation } from './use-transcript-navigation';
import { TranscriptTimeline } from './transcript-timeline';
import { TurnDetail } from './turn-detail';
export function Transcript({
  w,
  active = true,
  onCommand,
  onInsert,
  onEdit,
}: {
  w: Workspace;
  active?: boolean;
  onCommand: SendWorkspaceCommand;
  onInsert: (after: string | null) => void;
  onEdit: (t: Turn) => void;
}) {
  // These view preferences survive empty filters and turn changes.
  const [tab, setTab] = useState('preview'),
    [rendered, setRendered] = useState(true),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('normal');
  const list = w.turns.filter(
    (t) =>
      t.status === filter &&
      (!query ||
        t.messages.some((m) =>
          m.content.toLowerCase().includes(query.toLowerCase()),
        )),
  );
  const navigation = useTranscriptNavigation({
    initialCount: w.turns.length,
    turnCount: list.length,
    active,
    filter,
    query,
  });
  const { currentIndex, setIndex } = navigation;
  const current = list[currentIndex],
    c = coverage(w);
  const actual = current
    ? w.turns.findIndex((t) => t.id === current.id) + 1
    : 0;
  function status(s: Status) {
    if (!current) return;
    onCommand({
      type: 'turn/status',
      turnId: current.id,
      status: s,
      at: new Date().toISOString(),
    });
  }
  const recent = new Set(c.recent.map((t) => t.id)),
    covered = new Set(c.covered.map((t) => t.id)),
    gap = new Set(c.gap.map((t) => t.id));
  function mark(id: string) {
    return recent.has(id)
      ? 'recent'
      : gap.has(id)
        ? 'gap'
        : covered.has(id)
          ? 'covered'
          : 'pending';
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <PageTitle>
            对话原文{' '}
            <small className="title-count">
              {w.turns.length.toLocaleString()} 轮
            </small>
          </PageTitle>
        </div>
      </div>
      <ChainMap w={w} selectedTurnId={current?.id} includeInactive />
      <div className="timeline-toolbar">
        <Segments
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setIndex(0);
          }}
          options={[
            { id: 'normal', label: '全部原文' },
            { id: 'deprecated', label: '弃用' },
            { id: 'trash', label: '回收站' },
          ]}
        />
        <label className="search-field">
          <Search size={15} />
          <input
            aria-label="搜索原文"
            placeholder="搜索原文…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
          />
        </label>
      </div>
      {current ? (
        <>
          <TranscriptTimeline
            turns={w.turns}
            list={list}
            navigation={navigation}
            mark={mark}
          />
          <TurnDetail
            current={current}
            actual={actual}
            previousId={w.turns[actual - 2]?.id ?? null}
            mark={mark(current.id)}
            tab={tab}
            setTab={setTab}
            rendered={rendered}
            setRendered={setRendered}
            onEdit={onEdit}
            onInsert={onInsert}
            onStatus={status}
          />
        </>
      ) : (
        <Empty
          title={
            query
              ? '没有找到匹配轮次'
              : filter === 'normal'
                ? '从第一段对话开始'
                : '这里还没有内容'
          }
          detail="每一次保存、删除和召回，都以完整轮次为单位。"
        >
          {w.turns.length === 0 && !query && filter === 'normal' && (
            <Button onClick={() => onInsert(null)}>
              <Plus size={16} />
              写下第一轮
            </Button>
          )}
        </Empty>
      )}
      <div className="quiet-footer">
        <span>CONTEXT HUB</span>
        <span>记忆有来处，对话有归处。</span>
        <span>仅本地演示</span>
      </div>
    </>
  );
}
