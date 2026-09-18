'use client';
import { Database, ListTodo, Orbit, Plus, Search } from 'lucide-react';
import { useAccount } from '../../components/providers/account.tsx';
import { AdminLink } from '../../components/shared/settings-link.tsx';
import { type Workspace } from '../../lib/core/model.ts';
import { WorkspaceCard } from './card.tsx';

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
          <button
            className="journal-header-action"
            aria-label="搜索"
            onClick={onSearch}
          >
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
          {workspaces.map((w, i) => (
            <WorkspaceCard
              key={w.id}
              w={w}
              index={i}
              openingId={openingId}
              onOpen={onOpen}
            />
          ))}
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
