'use client';
import {
  BookOpen,
  Check,
  Layers,
  MessageSquare,
  PackageOpen,
  Plug,
  Settings2,
  StickyNote,
} from 'lucide-react';
import { Button } from '../../components/shared/button.tsx';
import { WorkspaceThemeRoot } from '../../components/theme/workspace-theme.tsx';
import { BackgroundTasksContext } from '../../lib/tasks/use-background-tasks.ts';
import { DataManager } from '../data/index.ts';
import { InboxPet } from '../inbox/index.ts';
import { WorkspaceDialogs } from './dialogs.tsx';
import { JournalHome } from './home.tsx';
import { WorkspacePanels } from './panels.tsx';
import { ReaderHeader } from './reader-header.tsx';
import { useWorkspaceController } from './use-controller.ts';
const navigation = [
  { id: 'archive', label: '原文', icon: MessageSquare },
  { id: 'summary', label: '摘要', icon: Layers },
  { id: 'notes', label: 'Note', icon: StickyNote },
  { id: 'memory', label: '记忆包', icon: PackageOpen },
  { id: 'connect', label: '连接', icon: Plug },
  { id: 'settings', label: '设置', icon: Settings2 },
];
export function Hub() {
  const controller = useWorkspaceController();
  const {
    data,
    persistence,
    cleanup,
    page,
    home,
    setHome,
    openingId,
    main,
    transition,
    openWorkspace,
    navigate,
    modal,
    setModal,
    notice,
    w,
    deliveries,
    noteNotifications,
    background,
    mcp,
  } = controller;
  if (!persistence.ready)
    return (
      <div className="loading-screen">
        <BookOpen size={38} />
        <h1>Context Hub</h1>
        <p role={persistence.error ? 'alert' : undefined}>
          {persistence.error || '正在加载…'}
        </p>
        {persistence.error && (
          <Button
            onClick={() => {
              void persistence.retry();
            }}
          >
            重试读取
          </Button>
        )}
        {persistence.error && (
          <Button onClick={() => setModal('data')}>从备份恢复</Button>
        )}
        {modal === 'data' && (
          <DataManager
            saved={false}
            onClose={() => setModal('')}
            onCleanup={cleanup}
          />
        )}
      </div>
    );
  return (
    <BackgroundTasksContext.Provider value={background}>
      <WorkspaceThemeRoot
        tone={!home ? (w.appearance?.tone ?? 'sage') : undefined}
      >
        {home && (
          <JournalHome
            saved={persistence.saved && !persistence.busy}
            openingId={openingId}
            workspaces={data.workspaces}
            onOpen={openWorkspace}
            onNew={() => setModal('new-workspace')}
            onSearch={() => navigate('search')}
            onAccount={() => setModal('account')}
            onData={() => setModal('data')}
            onTasks={() => setModal('tasks')}
          />
        )}
        {home && persistence.error && (
          <div role="alert" className="callout warning">
            {persistence.error}
            <Button
              onClick={() => {
                void persistence.retry();
              }}
            >
              重试保存
            </Button>
          </div>
        )}
        {(!home || openingId) && (
          <div
            className={`open-journal tone-${w.appearance?.tone ?? 'sage'}${home ? ' workspace-preparing' : ''}`}
            inert={home}
            aria-hidden={home}
          >
            <ReaderHeader
              workspaceName={w.name}
              chapter={
                navigation.find((n) => n.id === page)?.label ??
                (page === 'inbox' ? '收件箱' : '搜索')
              }
              persistence={persistence}
              onHome={() => transition(() => setHome(true))}
              onTasks={() => setModal('tasks')}
              onData={() => setModal('data')}
              onSearch={() => navigate('search')}
              onImport={() => setModal('import')}
            />
            <div className="journal-reader">
              <aside className="journal-margin">
                <span>{w.platform.toUpperCase()}</span>
                <i />
                <span>CONTEXT HUB</span>
              </aside>
              <div className="journal-sheet">
                <nav className="journal-tabs" aria-label="工作区章节">
                  {navigation.map((n) => (
                    <button
                      key={n.id}
                      disabled={!data.workspaces.length}
                      className={page === n.id ? 'selected' : ''}
                      aria-current={page === n.id ? 'page' : undefined}
                      onClick={() => navigate(n.id)}
                    >
                      <n.icon size={15} />
                      <span>{n.label}</span>
                    </button>
                  ))}
                </nav>
                {persistence.error && (
                  <div role="alert" className="callout warning">
                    {persistence.error}
                    <Button
                      onClick={() => {
                        void persistence.retry();
                      }}
                    >
                      重试保存
                    </Button>
                  </div>
                )}
                <main
                  className={`page-content${page === 'inbox' ? ' page-content-inbox' : ''}`}
                  key={w.id}
                  ref={main}
                >
                  <WorkspacePanels controller={controller} />
                </main>
              </div>
            </div>
          </div>
        )}
        <WorkspaceDialogs controller={controller} />
        <InboxPet
          count={
            deliveries.length +
            noteNotifications.filter((item) => !item.read).length
          }
          onClick={() => navigate('inbox')}
        />
        {(notice || mcp.received) && (
          <output className="journal-toast">
            <Check size={16} />
            {notice || mcp.received}
          </output>
        )}
      </WorkspaceThemeRoot>
    </BackgroundTasksContext.Provider>
  );
}
