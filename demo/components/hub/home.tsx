'use client';
import {
  ArrowUpRight,
  Plus,
  Search,
  Orbit,
  ArrowRight,
  Database,
} from 'lucide-react';
import { coverage, type Workspace } from '@/lib/domain';

export function JournalHome({
  openingId,
  workspaces,
  onOpen,
  onNew,
  onSearch,
  onAccount,
  onData,
  onImport,
}: {
  openingId: string | null;
  workspaces: Workspace[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onSearch: () => void;
  onAccount: () => void;
  onData: () => void;
  onImport: () => void;
}) {
  return (
    <div className="journal-home" inert={!!openingId} aria-busy={!!openingId}>
      <header className="journal-home-header">
        <button type="button" className="journal-wordmark">
          <Orbit size={23} />
          <span>Context Hub</span>
        </button>
        <div>
          <button
            className="journal-header-action"
            onClick={onData}
            aria-label="本地数据与备份"
          >
            <Database size={17} />
            <span>本地数据</span>
          </button>
          <button className="journal-header-action" onClick={onSearch}>
            <Search size={17} />
            <span>搜索记忆</span>
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
        <div className="shelf-heading">
          <h1>
            我的手账 <small>{String(workspaces.length).padStart(2, '0')}</small>
          </h1>
          <span>一个窗口，一本手账</span>
        </div>
        {!workspaces.length && (
          <div className="callout">
            <p>还没有手账。创建一本空白手账，或导入已有对话。</p>
            <button className="journal-header-action" onClick={onImport}>
              <Plus size={17} />
              收录对话
            </button>
          </div>
        )}
        <div className="notebook-grid">
          {workspaces.map((w, i) => {
            const c = coverage(w);
            return (
              <button
                className={`notebook-item book-tone-${i % 4}${openingId === w.id ? ' opening' : ''}`}
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
                    <span>{w.notes.length} 条 Note</span>
                  </div>
                  <span className="open-book-label">
                    {openingId === w.id ? '正在翻开…' : '翻开手账'}{' '}
                    <ArrowRight size={13} />
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
            <h2>新建手账</h2>
            <p>
              留给一段新的对话，
              <br />
              或另一个熟悉的窗口。
            </p>
            <span>
              创建手账 <ArrowUpRight size={14} />
            </span>
          </button>
        </div>
      </main>
      <footer className="journal-home-footer">
        <span>CONTEXT HUB · PERSONAL MEMORY JOURNAL</span>
        <span>数据保存在此浏览器 · 可从“本地数据”导出备份</span>
      </footer>
    </div>
  );
}
