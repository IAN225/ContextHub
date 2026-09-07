'use client';
import Image from 'next/image';
import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Code2,
  Clock,
  Archive,
  Trash2,
  RotateCcw,
  ChevronsRight,
  Paperclip,
} from 'lucide-react';
import {
  Button,
  PageTitle,
  Segments,
  Markdown,
  ChainMap,
  Empty,
  formatDate,
} from './shared';
import { coverage, type Workspace, type Turn, type Status } from '@/lib/domain';
export function Transcript({
  w,
  active = true,
  onChange,
  onInsert,
  onEdit,
}: {
  w: Workspace;
  active?: boolean;
  onChange: (w: Workspace) => void;
  onInsert: (after: string | null) => void;
  onEdit: (t: Turn) => void;
}) {
  const [index, setSelectedIndex] = useState(Math.max(0, w.turns.length - 1)),
    [tab, setTab] = useState('preview'),
    [rendered, setRendered] = useState(true),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('normal');
  const lane = useRef<HTMLDivElement>(null);
  const list = w.turns.filter(
    (t) =>
      t.status === filter &&
      (!query ||
        t.messages.some((m) =>
          m.content.toLowerCase().includes(query.toLowerCase()),
        )),
  );
  const currentIndex = Math.min(index, Math.max(0, list.length - 1)),
    current = list[currentIndex],
    c = coverage(w);
  const actual = current
    ? w.turns.findIndex((t) => t.id === current.id) + 1
    : 0;
  const selectedIndex = useRef(currentIndex);
  const touchSession = useRef(false);
  const turnCount = list.length;
  useLayoutEffect(() => {
    selectedIndex.current = currentIndex;
  }, [currentIndex]);
  const setIndex = useCallback(
    (next: number) => {
      const bounded = Math.max(0, Math.min(turnCount - 1, next));
      // Discrete input owns a target, even while the rail is between ticks.
      // Updating the ref synchronously also preserves rapid wheel/key input.
      touchSession.current = false;
      selectedIndex.current = bounded;
      setSelectedIndex(bounded);
      lane.current?.scrollTo({
        left: bounded * 104,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    },
    [turnCount],
  );
  useLayoutEffect(() => {
    touchSession.current = false;
    if (active && lane.current) {
      lane.current.scrollTo({
        left: selectedIndex.current * 104,
        behavior: 'instant',
      });
    }
  }, [active, filter, query, list.length]);
  useEffect(() => {
    if (!lane.current) return;
    const el = lane.current;
    let held = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let lastWheel = 0;
    let wheelDistance = 0;
    function settle() {
      clearTimeout(settleTimer);
      if (held || !touchSession.current) return;
      const next = Math.max(
        0,
        Math.min(list.length - 1, Math.round(el.scrollLeft / 104)),
      );
      if (Math.abs(el.scrollLeft - next * 104) < 1) return;
      el.scrollTo({
        left: next * 104,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    }
    function scheduleSettle() {
      clearTimeout(settleTimer);
      if (!held && touchSession.current) settleTimer = setTimeout(settle, 180);
    }
    function touchStart() {
      held = true;
      touchSession.current = true;
      // A finger down interrupts either native momentum or a discrete jump.
      el.scrollTo({ left: el.scrollLeft, behavior: 'instant' });
      const next = Math.max(
        0,
        Math.min(list.length - 1, Math.round(el.scrollLeft / 104)),
      );
      selectedIndex.current = next;
      setSelectedIndex(next);
      clearTimeout(settleTimer);
    }
    function touchEnd(e: TouchEvent) {
      held = e.touches.length > 0;
      scheduleSettle();
    }
    function scroll(e: WheelEvent) {
      if (e.ctrlKey) return;
      // Wheel input owns selection and positioning together; never allow a
      // second native pixel scroll after advancing the selected turn.
      e.preventDefault();
      clearTimeout(settleTimer);
      const delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const time = performance.now();
      if (
        time - lastWheel > 160 ||
        Math.sign(delta) !== Math.sign(wheelDistance)
      )
        wheelDistance = 0;
      lastWheel = time;
      wheelDistance += delta;
      if (e.deltaMode === 0 && Math.abs(wheelDistance) < 24) return;
      const next = Math.max(
        0,
        Math.min(
          list.length - 1,
          selectedIndex.current + Math.sign(wheelDistance),
        ),
      );
      wheelDistance = 0;
      setIndex(next);
    }
    el.addEventListener('wheel', scroll, { passive: false });
    el.addEventListener('touchstart', touchStart, { passive: true });
    el.addEventListener('touchend', touchEnd, { passive: true });
    el.addEventListener('touchcancel', touchEnd, { passive: true });
    el.addEventListener('scroll', scheduleSettle, { passive: true });
    el.addEventListener('scrollend', settle);
    return () => {
      clearTimeout(settleTimer);
      el.removeEventListener('wheel', scroll);
      el.removeEventListener('touchstart', touchStart);
      el.removeEventListener('touchend', touchEnd);
      el.removeEventListener('touchcancel', touchEnd);
      el.removeEventListener('scroll', scheduleSettle);
      el.removeEventListener('scrollend', settle);
    };
  }, [list.length, active, setIndex]);
  function status(s: Status) {
    if (!current) return;
    onChange({
      ...w,
      turns: w.turns.map((t) =>
        t.id === current.id
          ? {
              ...t,
              status: s,
              ...(s === 'trash'
                ? { deletedAt: new Date().toISOString() }
                : { deletedAt: undefined }),
            }
          : t,
      ),
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
          <div className="timeline">
            <input
              type="range"
              className="sr-only"
              aria-label="原文时间轴，左右方向键选择完整轮次"
              min={1}
              max={list.length}
              value={currentIndex + 1}
              onChange={(e) => setIndex(Number(e.target.value) - 1)}
            />
            <div className="timeline-rail" />
            <div className="timeline-ticks" />
            <div className="timeline-center">
              <span>当前轮次</span>
            </div>
            <div
              ref={lane}
              className="timeline-viewport"
              onScroll={(e) => {
                if (!touchSession.current) return;
                const next = Math.max(
                  0,
                  Math.min(
                    list.length - 1,
                    Math.round(e.currentTarget.scrollLeft / 104),
                  ),
                );
                selectedIndex.current = next;
                setSelectedIndex(next);
              }}
            >
              <div className="timeline-track">
                {list.map((t, i) => {
                  return (
                    <button
                      key={t.id}
                      className={`turn-point ${i === currentIndex ? 'selected' : ''} ${mark(t.id)}`}
                      aria-pressed={i === currentIndex}
                      tabIndex={i === currentIndex ? 0 : -1}
                      onClick={() => setIndex(i)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          const next = Math.max(
                            0,
                            Math.min(
                              list.length - 1,
                              selectedIndex.current +
                                (e.key === 'ArrowLeft' ? -1 : 1),
                            ),
                          );
                          setIndex(next);
                          const point = e.currentTarget.parentElement?.children[
                            next
                          ] as HTMLButtonElement | undefined;
                          point?.focus({ preventScroll: true });
                        }
                      }}
                      aria-label={`查看第 ${w.turns.indexOf(t) + 1} 轮`}
                    >
                      <span className="turn-number">
                        {String(w.turns.indexOf(t) + 1).padStart(3, '0')}
                      </span>
                      <span className="point-stem" />
                      <span className="point-dot" />
                      <span className="point-time">
                        {t.time ? formatDate(t.time).split(' ')[0] : '时间未知'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="timeline-bottom">
            <span>
              <span className="key">←</span> <span className="key">→</span>{' '}
              切换轮次 <span className="separator-dot">·</span> 滚动浏览 /
              触屏滑动
            </span>
            <div>
              <button
                className="icon-button"
                aria-label="上一轮"
                disabled={!currentIndex}
                onClick={() => setIndex(currentIndex - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <label>
                第{' '}
                <input
                  aria-label="跳转到筛选结果轮次"
                  className="jump-input"
                  type="number"
                  min={1}
                  max={list.length}
                  value={currentIndex + 1}
                  onChange={(e) =>
                    setIndex(
                      Math.max(
                        0,
                        Math.min(list.length - 1, Number(e.target.value) - 1),
                      ),
                    )
                  }
                />{' '}
                / {list.length} 轮
              </label>
              <button
                className="icon-button"
                aria-label="下一轮"
                disabled={currentIndex === list.length - 1}
                onClick={() => setIndex(currentIndex + 1)}
              >
                <ChevronRight size={16} />
              </button>
              <button
                className="text-button"
                onClick={() => setIndex(list.length - 1)}
              >
                最近 <ChevronsRight size={14} />
              </button>
            </div>
          </div>
          <div className="turn-detail">
            <div className="detail-top">
              <div className="turn-badge">
                {String(actual).padStart(3, '0')}
              </div>
              <div>
                <h2>{current.title}</h2>
                <div className="metadata-line">
                  <span className="platform-dot" />
                  {current.source}
                  <span>·</span>
                  <Clock size={12} />
                  {formatDate(current.time)}
                  <span>·</span>
                  <span
                    className={mark(current.id) === 'gap' ? 'amber' : 'mint'}
                  >
                    {
                      {
                        recent: '近期原文 · 将随记忆包返回',
                        covered: '已纳入摘要',
                        gap: '不在摘要内 · 记忆缺口',
                        pending: '待压缩原文',
                      }[mark(current.id)]
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
              <span>{current.messages.length} 条消息 · 完整轮次</span>
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
                        {m.role === 'assistant' && (
                          <button
                            className="render-toggle"
                            onClick={() => setRendered(!rendered)}
                          >
                            {rendered ? 'Markdown ↔' : '原始文本 ↔'}
                          </button>
                        )}
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
                    attachments: current.attachments?.map(
                      ({ url: _url, ...a }) => a,
                    ),
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
              <Button onClick={() => onInsert(w.turns[actual - 2]?.id ?? null)}>
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
            {filter === 'trash' && (
              <p className="callout">
                回收站按完整轮次保留。正式版将在删除 30 天后清理；本地 demo
                不运行后台清理。
              </p>
            )}
          </div>
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
