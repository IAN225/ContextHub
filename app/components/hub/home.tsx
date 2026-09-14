'use client';
import { AdminLink } from './admin-link';
import { useAccount } from './account';
import {
  ArrowUpRight,
  Plus,
  Search,
  Orbit,
  ArrowRight,
  Database,
  ListTodo,
} from 'lucide-react';
import { coverage, type Workspace } from '@/lib/domain';

export function JournalHome({
  saved,
  openingId,
  workspaces,
  onOpen,
  onNew,
  onSearch,
  onAccount,
  onData,
  onTasks,
}: {
  saved: boolean;
  openingId: string | null;
  workspaces: Workspace[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onSearch: () => void;
  onAccount: () => void;
  onData: () => void;
  onTasks: () => void;
}) {
  const { user } = useAccount();
  return (
    <div className="journal-home" inert={!!openingId} aria-busy={!!openingId}>
      <header className="journal-home-header">
        <button type="button" className="journal-wordmark">
          <Orbit size={23} />
          <span>Context Hub</span>
        </button>
        <div>
          <AdminLink saved={saved} />
          <button
            className="journal-header-action"
            onClick={onTasks}
            aria-label="后台任务"
          >
            <ListTodo size={17} />
            <span>后台任务</span>
          </button>
          <button
            className="journal-header-action"
            onClick={onData}
            aria-label="数据管理"
          >
            <Database size={17} />
            <span>数据管理</span>
          </button>
          <button className="journal-header-action" onClick={onSearch}>
            <Search size={17} />
            <span>搜索</span>
          </button>
          <button
            className="journal-avatar"
            aria-label="我的账号"
            title={user?.username}
            onClick={onAccount}
          >
            {user?.username.slice(0, 1).toUpperCase() || 'Y'}
          </button>
        </div>
      </header>
      <main className="journal-shelf">
        <div className="shelf-heading">
          <h1>
            工作区 <small>{String(workspaces.length).padStart(2, '0')}</small>
          </h1>
        </div>
        <div className="notebook-grid">
          {workspaces.map((w, i) => {
            const c = coverage(w);
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
                    {openingId === w.id ? '正在打开…' : '打开'}{' '}
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
              </button>
            );
          })}
          <button className="new-notebook" onClick={onNew}>
            <span className="new-notebook-icon">
              <Plus size={25} />
            </span>
            <h2>新建工作区</h2>
          </button>
        </div>
      </main>
    </div>
  );
}
