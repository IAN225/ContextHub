'use client';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { ChainMap } from '../../components/shared/coverage-map.tsx';
import { type Workspace } from '../../lib/core/model.ts';
import { workspaceThemeClass } from '../../lib/workspaces/theme.ts';
export function WorkspaceCard({
  w,
  index: i,
  openingId,
  onOpen,
}: {
  w: Workspace;
  index: number;
  openingId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      className={`notebook-item book-tone-${i % 4}${w.appearance?.tone ? ' tone-' + w.appearance.tone : ''}${openingId === w.id ? ' opening' : ''}`}
      aria-label={w.name}
      key={w.id}
      onClick={() => onOpen(w.id)}
    >
      <div className="notebook-cover">
        <div className="notebook-spine" />
        <div className="notebook-bookmark" />
        <div className="notebook-cover-top">
          <span>{w.platform.toUpperCase()}</span>
          <span>NO. {String(i + 1).padStart(2, '0')}</span>
        </div>
        <div className="notebook-title">
          <h2>{w.name}</h2>
          <div className="book-title-rule" />
        </div>
        <div className="notebook-cover-bottom">
          <span>CONVERSATIONS & MEMORIES</span>
          <ArrowUpRight size={17} />
        </div>
        <div className="notebook-paper-edges" />
      </div>
      <div className="notebook-caption">
        <div>
          <span>{w.turns.length} 轮对话</span>
          <i>·</i>
          <span>{w.notes.length} 条 Note</span>
        </div>
        <span className="open-book-label">
          {openingId === w.id ? '正在打开…' : '打开'} <ArrowRight size={13} />
        </span>
      </div>
      <div
        className={
          'book-progress ' + workspaceThemeClass(w.appearance?.tone ?? 'sage')
        }
      >
        <ChainMap w={w} compact />
      </div>
    </button>
  );
}
