'use client';
import {
  ArrowUpRight,
  Plus,
  Inbox,
  Search,
  Orbit,
  BookOpen,
  ArrowRight,
  Feather,
} from 'lucide-react';
import { coverage, type Workspace } from '@/lib/domain';

export function JournalHome({
  workspaces,
  uploads,
  onOpen,
  onNew,
  onInbox,
  onSearch,
  onAccount,
}: {
  workspaces: Workspace[];
  uploads: number;
  onOpen: (id: string) => void;
  onNew: () => void;
  onInbox: () => void;
  onSearch: () => void;
  onAccount: () => void;
}) {
  return (
    <div className="journal-home">
      <header className="journal-home-header">
        <button type="button" className="journal-wordmark">
          <Orbit size={23} />
          <span>Context Hub</span>
          <small>一处记忆的住所</small>
        </button>
        <div>
          <button className="journal-header-action" onClick={onSearch}>
            <Search size={17} />
            <span>找一段记忆</span>
          </button>
          <button className="journal-header-action" onClick={onInbox}>
            <Inbox size={17} />
            <span>收件箱</span>
            {uploads > 0 && <i>{uploads}</i>}
          </button>
          <button
            className="journal-avatar"
            aria-label="个人空间"
            onClick={onAccount}
          >
            Y
          </button>
        </div>
      </header>
      <main className="journal-shelf">
        <div className="journal-greeting">
          <div className="journal-date">
            <span>SEPTEMBER</span>
            <span>2026</span>
            <i />
          </div>
          <div className="journal-intro">
            <div className="journal-overline">
              <Feather size={14} /> 我的手账
            </div>
            <h1>
              每段对话，
              <br className="home-mobile-break" />
              都值得有下文<span>。</span>
            </h1>
            <p>
              把散落在不同窗口的记忆，收在这里。
              <br />
              下次见面，就从熟悉的那一页继续。
            </p>
          </div>
          <span className="handwritten">慢慢记录，慢慢来。</span>
        </div>
        <div className="shelf-heading">
          <span>
            我的对话册{' '}
            <small>{String(workspaces.length).padStart(2, '0')}</small>
          </span>
          <span>一个窗口，一本手账</span>
        </div>
        <div className="notebook-grid">
          {workspaces.map((w, i) => {
            const c = coverage(w);
            return (
              <button
                className={`notebook-item book-tone-${i % 4}`}
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
                    <span className="book-emblem">
                      {i % 3 === 0 ? '✳' : i % 3 === 1 ? '❋' : '✧'}
                    </span>
                    <h2>{w.name}</h2>
                    <div className="book-title-rule" />
                    <p>
                      {i % 3 === 0
                        ? '那些说过的话，\n还有被理解的瞬间。'
                        : i % 3 === 1
                          ? '收集忽然出现的灵感，\n也给未写完的故事留一页。'
                          : '不用整理好，\n想到什么，就记下来。'}
                    </p>
                  </div>
                  <div className="notebook-cover-bottom">
                    <span>CONVERSATIONS & MEMORIES</span>
                    <ArrowUpRight size={17} />
                  </div>
                  <div className="notebook-paper-edges" />
                </div>
                <div className="notebook-caption">
                  <div>
                    <span>
                      {w.turns.length ? `${w.turns.length} 轮对话` : '还未落笔'}
                    </span>
                    <i>·</i>
                    <span>{w.notes.length} 条便签</span>
                  </div>
                  <span className="open-book-label">
                    翻开手账 <ArrowRight size={13} />
                  </span>
                </div>
                <div className="book-progress">
                  <span
                    style={{
                      width: `${w.turns.length ? (c.covered.length / w.turns.length) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="notebook-footnote">
                  {c.active
                    ? '早期记忆已整理，可以从最近的对话继续。'
                    : '等你写下或带来第一段对话。'}
                </p>
              </button>
            );
          })}
          <button className="new-notebook" onClick={onNew}>
            <span className="new-notebook-icon">
              <Plus size={25} />
            </span>
            <h2>再开一本</h2>
            <p>
              留给一段新的对话，
              <br />
              或另一个熟悉的窗口。
            </p>
            <span>
              创建工作区 <ArrowUpRight size={14} />
            </span>
          </button>
        </div>
        <div className="journal-bottom-note">
          <BookOpen size={20} />
          <div>
            <p>不必从头解释，也不必记住所有细节。</p>
            <span>记下重要的，让对话自然继续。</span>
          </div>
        </div>
      </main>
      <footer className="journal-home-footer">
        <span>CONTEXT HUB · PERSONAL MEMORY JOURNAL</span>
        <span>本地 Demo · 示例数据仅保存在此浏览器</span>
      </footer>
    </div>
  );
}
