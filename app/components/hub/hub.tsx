'use client';
import { WorkspaceThemeRoot } from './workspace-theme';
import {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from 'react';
import { AccountPanel } from '@/components/hub/account';
import {
  MessageSquare,
  Layers,
  StickyNote,
  PackageOpen,
  Plug,
  Check,
  BookOpen,
  Settings2,
} from 'lucide-react';
import { WorkspaceSettings } from './workspace-settings';
import { mcpRequest } from '@/lib/mcp/client';
import { ReaderHeader } from './reader-header';
import { useJournalNavigation } from '@/lib/use-journal-navigation';
import { JournalHome } from '@/components/hub/home';
import { DataManager } from '@/components/hub/data-manager';
import { BackgroundTaskManager } from '@/components/hub/background-tasks';
import {
  BackgroundTasksContext,
  useBackgroundTasks,
} from '@/lib/tasks/use-background-tasks';
import { Transcript } from '@/components/hub/transcript';
import { SummaryPage } from '@/components/hub/summary-page';
import { NotesPage } from '@/components/hub/notes';
import { MemoryPage } from '@/components/hub/memory';
import { InboxPage } from '@/components/hub/inbox';
import { ImportDialog } from '@/components/hub/import-dialog';
import { UploadReview } from '@/components/hub/upload-review';
import { InboxPet } from '@/components/hub/inbox-pet';
import { ConnectionsPage } from '@/components/hub/connections';
import { SearchPage } from '@/components/hub/search';
import { TurnEditor, NewWorkspace } from '@/components/hub/editors';
import { Button, Modal } from '@/components/hub/shared';
import { useHub } from '@/lib/use-hub';
import type { WorkspaceCommand } from '@/lib/hub-state';
import type { StorageEntry } from '@/lib/repository';
import { useMcp } from '@/lib/mcp/use-mcp';
import { useDeliveryInbox } from '@/lib/imports/use-delivery-inbox';
import {
  blankWorkspace,
  uid,
  now,
  pendingUploads,
  inboxUploads,
  type Workspace,
  type Turn,
  type Upload,
} from '@/lib/domain';
const navigation = [
  { id: 'archive', label: '原文', icon: MessageSquare },
  { id: 'summary', label: '摘要', icon: Layers },
  { id: 'notes', label: 'Note', icon: StickyNote },
  { id: 'memory', label: '记忆包', icon: PackageOpen },
  { id: 'connect', label: '连接', icon: Plug },
  { id: 'settings', label: '设置', icon: Settings2 },
];
export function Hub() {
  const { data, persistence, dispatch, commit, cleanup, removeWorkspace } =
    useHub();
  const [emptyWorkspace] = useState(() => ({
    ...blankWorkspace('尚未创建工作区'),
    id: 'empty-workspace',
  }));
  const navigationState = useJournalNavigation(data.workspaces);
  const {
    workspaceId,
    setWorkspaceId,
    page,
    visitedPages,
    home,
    setHome,
    openingId,
    main,
    transition,
    openWorkspace,
    navigate,
  } = navigationState;
  const [modal, setModal] = useState(''),
    [afterId, setAfterId] = useState<string | null>(null),
    [editing, setEditing] = useState<Turn | undefined>(),
    [notice, setNotice] = useState('');
  const w =
    data.workspaces.find((w) => w.id === workspaceId) ??
    data.workspaces[0] ??
    emptyWorkspace;
  const onWorkspaceCommand = useCallback(
    (command: WorkspaceCommand) => {
      dispatch({ type: 'workspace', workspaceId: w.id, command });
    },
    [dispatch, w.id],
  );
  const commitWorkspace = useCallback(
    (command: WorkspaceCommand, companion?: StorageEntry) =>
      commit({ type: 'workspace', workspaceId: w.id, command }, companion),
    [commit, w.id],
  );
  const currentView = useRef({ workspaceId, modal, page, home });
  useLayoutEffect(() => {
    currentView.current = { workspaceId, modal, page, home };
  }, [workspaceId, modal, page, home]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const deliveries = inboxUploads(data.uploads);
  const noteNotifications = data.noteNotifications ?? [];
  const directImports = pendingUploads(data.uploads, 'manual');
  const candidates = pendingUploads(data.uploads, 'workbench', w.id);
  const receiveDeliveries = useCallback(
    (uploads: Upload[]) => commit({ type: 'upload/receive', uploads }),
    [commit],
  );
  const deliveryInbox = useDeliveryInbox(
    persistence.ready && modal !== 'data',
    receiveDeliveries,
  );
  const background = useBackgroundTasks(
    data,
    persistence.ready && modal !== 'data',
    commit,
  );
  const mcp = useMcp(
    data,
    persistence.ready && persistence.saved && modal !== 'data',
    commit,
  );
  function notify(text: string) {
    setNotice(text);
  }
  function updateUpload(next: Upload) {
    dispatch({ type: 'upload/update', upload: next });
  }
  async function importConversation(u: Upload) {
    const origin = currentView.current;
    const saved = await commit({ type: 'upload/add', upload: u });
    if (saved && currentView.current === origin) {
      if (inboxUploads([u]).length) {
        navigate('inbox');
        setModal('');
        notify('已导入收件箱。');
      } else setModal('review-manual');
    }
    return saved;
  }
  function removeUpload(id: string) {
    dispatch({ type: 'upload/remove', uploadId: id });
  }
  async function importUpload(
    u: Upload,
    target: string,
    excludedTriggerId?: string,
  ) {
    const origin = currentView.current;
    const fresh =
      target === 'new'
        ? blankWorkspace(u.title, u.turns[0]?.source ?? '导入')
        : null;
    const saved = await commit({
      type: 'upload/archive',
      uploadId: u.id,
      target: fresh ?? target,
      batchId: uid(),
      excludedTriggerId,
    });
    if (!saved) {
      notify('归档失败，待归档内容已保留。');
      return false;
    }
    if (currentView.current === origin) {
      openWorkspace(fresh?.id ?? target);
      setModal('');
      notify('对话已归档。');
    }
    return true;
  }
  async function applySummary(
    u: Upload,
    target: Workspace,
    mode: 'keep' | 'rewind',
  ) {
    const origin = currentView.current;
    const saved = await commit({
      type: 'upload/summary',
      uploadId: u.id,
      workspaceId: target.id,
      mode,
      at: now(),
    });
    if (!saved) {
      notify('摘要保存失败，候选内容已保留。');
      return false;
    }
    if (currentView.current === origin) {
      setWorkspaceId(target.id);
      navigate('summary');
      setModal('');
      notify('候选摘要已设为活跃，原文处理水位按你的选择更新。');
    }
    return true;
  }
  function edit(t: Turn) {
    setEditing(t);
    setAfterId(null);
    setModal('turn');
  }
  function insert(id: string | null) {
    setEditing(undefined);
    setAfterId(id);
    setModal('turn');
  }
  async function saveTurn(turn: Turn, companion: StorageEntry) {
    const origin = currentView.current;
    const saved = await commitWorkspace(
      { type: 'turn/save', turn, insert: !editing, afterId },
      companion,
    );
    if (saved && currentView.current === origin) {
      setModal('');
      notify('完整轮次已保存。');
    }
    return saved;
  }
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
                  {visitedPages
                    .filter(
                      (panel) =>
                        data.workspaces.length > 0 ||
                        ['inbox', 'search'].includes(panel),
                    )
                    .map((panel) => (
                      <div
                        key={panel}
                        className={`chapter-panel${panel === 'inbox' ? ' inbox-chapter' : ''}`}
                        hidden={page !== panel}
                      >
                        {panel === 'archive' ? (
                          <Transcript
                            w={w}
                            active={!home && page === 'archive'}
                            onCommand={onWorkspaceCommand}
                            onInsert={insert}
                            onEdit={edit}
                          />
                        ) : panel === 'summary' ? (
                          <SummaryPage
                            w={w}
                            active={
                              !home &&
                              page === 'summary' &&
                              persistence.ready &&
                              modal !== 'data'
                            }
                            onCommand={onWorkspaceCommand}
                            onCommit={commitWorkspace}
                            pendingCount={candidates.length}
                            onReview={() => setModal('review-workbench')}
                          />
                        ) : panel === 'notes' ? (
                          <NotesPage
                            w={w}
                            onCommand={onWorkspaceCommand}
                            onCommit={commitWorkspace}
                          />
                        ) : panel === 'memory' ? (
                          <MemoryPage w={w} onCommand={onWorkspaceCommand} />
                        ) : panel === 'inbox' ? (
                          <>
                            {deliveryInbox.error && (
                              <p role="alert" className="callout warning">
                                {deliveryInbox.error}
                              </p>
                            )}
                            <InboxPage
                              notifications={noteNotifications}
                              onRead={(id) =>
                                dispatch({
                                  type: 'notification/read',
                                  notificationId: id,
                                })
                              }
                              uploads={deliveries}
                              workspaces={data.workspaces}
                              currentId={w.id}
                              onUpdate={updateUpload}
                              onRemove={removeUpload}
                              onImport={importUpload}
                              onSummary={applySummary}
                            />
                          </>
                        ) : panel === 'settings' ? (
                          <WorkspaceSettings
                            w={w}
                            onCommit={commitWorkspace}
                            ready={background.ready && persistence.saved}
                            onDelete={async () => {
                              for (const task of background.tasks.filter(
                                (t) =>
                                  t.workspace_id === w.id &&
                                  ![
                                    'cancelled',
                                    'completed',
                                    'failed',
                                  ].includes(t.status),
                              ))
                                await background.control(task.id, 'cancel');
                              await mcpRequest('remove-workspace', {
                                workspaceId: w.id,
                              });
                              const saved = await removeWorkspace(w.id);
                              if (saved) {
                                mcp.refresh();
                                transition(() => setHome(true));
                              }
                              return saved;
                            }}
                          />
                        ) : panel === 'connect' ? (
                          <ConnectionsPage
                            w={w}
                            active={!home && page === 'connect'}
                            mcp={mcp}
                          />
                        ) : (
                          <SearchPage
                            workspaces={data.workspaces}
                            currentId={w.id}
                          />
                        )}
                      </div>
                    ))}
                </main>
              </div>
            </div>
          </div>
        )}
        {modal === 'turn' && (
          <TurnEditor
            key={`${w.id}-${editing?.id ?? afterId ?? 'start'}`}
            w={w}
            turn={editing}
            afterId={afterId}
            onSave={saveTurn}
            onClose={() => setModal('')}
          />
        )}{' '}
        {modal === 'new-workspace' && (
          <NewWorkspace
            onClose={() => setModal('')}
            onCreate={async (name, platform, companion) => {
              const origin = currentView.current;
              const x = blankWorkspace(name, platform);
              const saved = await commit(
                { type: 'workspace/create', workspace: x },
                companion,
              );
              if (saved && currentView.current === origin) {
                setModal('');
                openWorkspace(x.id);
              }
              return saved;
            }}
          />
        )}{' '}
        {modal === 'import' && (
          <ImportDialog
            onUpload={importConversation}
            onDeliveryEnabled={deliveryInbox.activate}
            onClose={() => setModal('')}
            pendingCount={directImports.length}
            onReview={() => setModal('review-manual')}
          />
        )}{' '}
        {(modal === 'review-manual' || modal === 'review-workbench') && (
          <Modal
            title={modal === 'review-manual' ? '确认对话导入' : '确认候选摘要'}
            description={
              modal === 'review-manual'
                ? '预览后选择工作区归档；未确认的内容可从收录对话入口继续处理。'
                : '确认后设为活跃摘要；未确认的候选会保留在当前工作区的摘要工作台。'
            }
            onClose={() => setModal('')}
          >
            <div className="upload-review-dialog">
              <UploadReview
                key={`${modal}-${w.id}`}
                uploads={modal === 'review-manual' ? directImports : candidates}
                workspaces={data.workspaces}
                currentId={w.id}
                onUpdate={updateUpload}
                onRemove={removeUpload}
                onImport={importUpload}
                onSummary={applySummary}
              />
            </div>
          </Modal>
        )}
        {modal === 'account' && (
          <Modal
            title="我的账号"
            description="管理你的登录信息和账号安全。"
            onClose={() => setModal('')}
          >
            <AccountPanel saved={persistence.saved && !persistence.busy} />
          </Modal>
        )}
        {modal === 'tasks' && (
          <BackgroundTaskManager onClose={() => setModal('')} />
        )}
        {modal === 'data' && (
          <DataManager
            state={data}
            saved={persistence.saved && !persistence.busy}
            onClose={() => setModal('')}
            onCleanup={cleanup}
          />
        )}
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
