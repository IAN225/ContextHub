'use client';
import {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeft,
  Plus,
  Search,
  MessageSquare,
  Layers,
  StickyNote,
  PackageOpen,
  Plug,
  Check,
  BookOpen,
  ChevronRight,
} from 'lucide-react';
import { JournalHome } from '@/components/hub/home';
import { Transcript } from '@/components/hub/transcript';
import { SummaryPage } from '@/components/hub/summary';
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
import { useDemoMemoryTools } from '@/lib/webmcp';
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
];
export default function Hub() {
  const { data, persistence, dispatch, commit } = useHub();
  const [workspaceId, setWorkspaceId] = useState('ws-everyday'),
    [page, setPage] = useState('archive'),
    [visitedPages, setVisitedPages] = useState(['archive']),
    [home, setHome] = useState(true),
    [openingId, setOpeningId] = useState<string | null>(null),
    [modal, setModal] = useState(''),
    [afterId, setAfterId] = useState<string | null>(null),
    [editing, setEditing] = useState<Turn | undefined>(),
    [notice, setNotice] = useState('');
  const w =
    data.workspaces.find((w) => w.id === workspaceId) ?? data.workspaces[0];
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
  const currentView = useRef({ workspaceId: w.id, modal, page, home });
  useLayoutEffect(() => {
    currentView.current = { workspaceId: w.id, modal, page, home };
  }, [w.id, modal, page, home]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const deliveries = inboxUploads(data.uploads);
  const directImports = pendingUploads(data.uploads, 'manual');
  const candidates = pendingUploads(data.uploads, 'workbench', w.id);
  const receiveDeliveries = useCallback(
    (uploads: Upload[]) => commit({ type: 'upload/receive', uploads }),
    [commit],
  );
  const deliveryInbox = useDeliveryInbox(persistence.ready, receiveDeliveries);
  useDemoMemoryTools(w);
  const main = useRef<HTMLElement>(null);
  const opening = useRef(false);
  const chapterScroll = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    if (main.current)
      main.current.scrollTop = chapterScroll.current[`${w.id}-${page}`] ?? 0;
  }, [page, w.id, home]);
  const transition = useCallback((fn: () => void) => {
    const update = () => {
      flushSync(fn);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    if (
      document.startViewTransition &&
      !window.matchMedia('(max-width: 760px), (prefers-reduced-motion: reduce)')
        .matches
    ) {
      const animation = document.startViewTransition(update);
      // A skipped snapshot must not surface as an unhandled rejection.
      void animation.ready.catch(() => {});
      void animation.finished.catch(() => {});
    } else update();
  }, []);
  useEffect(() => {
    if (!openingId) return;
    // Mount the selected archive behind the shelf while its cover lifts.
    // Match --notebook-open-duration; start after the prepared tree commits.
    const timer = setTimeout(() => {
      transition(() => {
        if (!opening.current) return;
        setHome(false);
        setOpeningId(null);
        opening.current = false;
      });
    }, 380);
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpeningId(null);
        opening.current = false;
      }
    };
    document.addEventListener('keydown', cancel);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', cancel);
    };
  }, [openingId, transition]);
  function openWorkspace(id: string) {
    if (opening.current) return;
    setWorkspaceId(id);
    setPage('archive');
    setVisitedPages(['archive']);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition(() => setHome(false));
    } else {
      opening.current = true;
      setOpeningId(id);
    }
  }
  function navigate(target: string) {
    if (target === page && !home) return;
    if (main.current)
      chapterScroll.current[`${w.id}-${page}`] = main.current.scrollTop;
    setVisitedPages((pages) =>
      pages.includes(target) ? pages : [...pages, target],
    );
    setPage(target);
    setHome(false);
  }
  function notify(text: string) {
    setNotice(text);
  }
  function upload(u: Upload) {
    dispatch({ type: 'upload/add', upload: u });
    if (inboxUploads([u]).length) {
      navigate('inbox');
      setModal('');
      notify('对话已放入收件箱，可随时归档到手账。');
    } else {
      setModal(u.kind === 'summary' ? 'review-workbench' : 'review-manual');
    }
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
        notify('对话已放入收件箱，可随时归档到手账。');
      } else setModal('review-manual');
    }
    return saved;
  }
  function removeUpload(id: string) {
    dispatch({ type: 'upload/remove', uploadId: id });
  }
  async function importUpload(u: Upload, target: string) {
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
    });
    if (!saved) {
      notify('归档失败，待归档内容已保留。');
      return false;
    }
    if (currentView.current === origin) {
      openWorkspace(fresh?.id ?? target);
      setModal('');
      notify('对话已完整收进手账。');
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
          {persistence.error || '正在翻开你的手账…'}
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
      </div>
    );
  return (
    <div className="journal-app">
      {home && (
        <JournalHome
          openingId={openingId}
          workspaces={data.workspaces}
          onOpen={openWorkspace}
          onNew={() => setModal('new-workspace')}
          onSearch={() => navigate('search')}
          onAccount={() => setModal('account')}
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
          className={`open-journal${home ? ' workspace-preparing' : ''}`}
          inert={home}
          aria-hidden={home}
        >
          <header className="journal-reader-header">
            <button
              className="back-to-shelf"
              aria-label="返回我的手账"
              onClick={() => transition(() => setHome(true))}
            >
              <ArrowLeft size={16} />
              <span>我的手账</span>
            </button>
            <div className="reader-breadcrumb">
              <span title={w.name}>{w.name}</span>
              <ChevronRight size={13} />
              <span>
                {navigation.find((n) => n.id === page)?.label ??
                  (page === 'inbox' ? '收件箱' : '搜索记忆')}
              </span>
            </div>
            <div className="reader-actions">
              <span className="save-state">
                <span
                  className={`status-dot ${persistence.error ? 'error' : ''}`}
                />
                {persistence.error
                  ? '保存失败'
                  : persistence.saved
                    ? '已收好'
                    : '保存中…'}
              </span>
              <button
                className="icon-button"
                aria-label="搜索记忆"
                onClick={() => navigate('search')}
              >
                <Search size={17} />
              </button>
              <Button onClick={() => setModal('import')}>
                <Plus size={14} />
                收录对话
              </Button>
            </div>
          </header>
          <div className="journal-reader">
            <aside className="journal-margin">
              <span>{w.platform.toUpperCase()}</span>
              <i />
              <span>CONTEXT HUB</span>
            </aside>
            <div className="journal-sheet">
              <nav className="journal-tabs" aria-label="手账章节">
                {navigation.map((n) => (
                  <button
                    key={n.id}
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
              <main className="page-content" key={w.id} ref={main}>
                {visitedPages.map((panel) => (
                  <div
                    key={panel}
                    className="chapter-panel"
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
                          !persistence.busy &&
                          !persistence.error
                        }
                        onCommand={onWorkspaceCommand}
                        onUpload={upload}
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
                          uploads={deliveries}
                          workspaces={data.workspaces}
                          currentId={w.id}
                          onUpdate={updateUpload}
                          onRemove={removeUpload}
                          onImport={importUpload}
                          onSummary={applySummary}
                        />
                      </>
                    ) : panel === 'connect' ? (
                      <ConnectionsPage
                        w={w}
                        active={!home && page === 'connect'}
                        onCommand={onWorkspaceCommand}
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
              ? '预览后选择手账归档；未确认的内容可从收录对话入口继续处理。'
              : '确认后设为活跃摘要；未确认的候选会保留在当前手账的摘要工作台。'
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
        <Modal title="这本手账，只在此处" onClose={() => setModal('')}>
          <p className="callout">
            手账与草稿保存在当前浏览器。客户端投递先保存在本机服务的收件队列，浏览器接收成功后清除服务端正文。账号与云端同步尚未接入。
          </p>
        </Modal>
      )}
      <InboxPet count={deliveries.length} onClick={() => navigate('inbox')} />
      {notice && (
        <output className="journal-toast">
          <Check size={16} />
          {notice}
        </output>
      )}
    </div>
  );
}
