'use client';
import { ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { formatDate } from './shared';
import type { Turn } from '@/lib/domain';
import type { useTranscriptNavigation } from './use-transcript-navigation';
export type TurnCoverageMark = 'recent' | 'gap' | 'covered' | 'pending';
export function TranscriptTimeline({
  turns,
  list,
  navigation,
  mark,
}: {
  turns: Turn[];
  list: Turn[];
  navigation: ReturnType<typeof useTranscriptNavigation>;
  mark: (id: string) => TurnCoverageMark;
}) {
  const { lane, currentIndex, setIndex, onScroll, onPointKeyDown } = navigation;
  return (
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
        <div ref={lane} className="timeline-viewport" onScroll={onScroll}>
          <div className="timeline-track">
            {list.map((t, i) => {
              return (
                <button
                  key={t.id}
                  className={`turn-point ${i === currentIndex ? 'selected' : ''} ${mark(t.id)}`}
                  aria-pressed={i === currentIndex}
                  tabIndex={i === currentIndex ? 0 : -1}
                  onClick={() => setIndex(i)}
                  onKeyDown={onPointKeyDown}
                  aria-label={`查看第 ${turns.indexOf(t) + 1} 轮`}
                >
                  <span className="turn-number">
                    {String(turns.indexOf(t) + 1).padStart(3, '0')}
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
          <span className="key">←</span> <span className="key">→</span> 切换轮次{' '}
          <span className="separator-dot">·</span> 滚动浏览 / 触屏滑动
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
    </>
  );
}
