'use client';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { ChainMap } from '../../components/shared/coverage-map.tsx';
import { Empty } from '../../components/shared/empty.tsx';
import { Segments } from '../../components/shared/segments.tsx';
import {
  type Status,
  type Turn,
  type Workspace,
} from '../../lib/core/model.ts';
import { type SendWorkspaceCommand } from '../../lib/state/contracts.ts';
import { coverage } from '../../lib/summary/coverage.ts';
import { TranscriptTimeline } from './timeline.tsx';
import { TurnDetail } from './turn-detail.tsx';
import { useTranscriptNavigation } from './use-navigation.ts';
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
  const list = useMemo(() => {
    const needle = query.toLowerCase();
    return w.turns.filter(
      (t) =>
        t.status === filter &&
        (!needle ||
          t.messages.some((m) => m.content.toLowerCase().includes(needle))),
    );
  }, [w.turns, filter, query]);
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
      <h2 className="sr-only">对话原文</h2>
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
            appearance={w.appearance}
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
          detail=""
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
      </div>
    </>
  );
}
