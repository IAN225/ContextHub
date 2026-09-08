'use client';
import {
  useState,
  useMemo,
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
import { ImportDialog, InboxPage, UploadReview } from '@/components/hub/inbox';
import { InboxPet } from '@/components/hub/inbox-pet';
import { ConnectionsPage } from '@/components/hub/connections';
import { SearchPage } from '@/components/hub/search';
import { TurnEditor, NewWorkspace } from '@/components/hub/editors';
import { Button, Modal } from '@/components/hub/shared';
import { createSeed } from '@/lib/seed';
import { usePersistent } from '@/lib/store';
import { useDemoMemoryTools } from '@/lib/webmcp';
import {
  blankWorkspace,
  restoreSummary,
  uid,
  now,
  pendingUploads,
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
  const initial = useMemo(() => createSeed(), []);
  const [data, setData, persistence] = usePersistent('hub-state-v1', initial);
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
  const deliveries = pendingUploads(data.uploads, 'api');
  const linkImports = pendingUploads(data.uploads, 'link');
  const candidates = pendingUploads(data.uploads, 'workbench', w.id);
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
  function update(next: Workspace) {
    setData((d) => ({
      ...d,
      workspaces: d.workspaces.map((x) => (x.id === next.id ? next : x)),
    }));
  }
  function notify(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(''), 4500);
  }
  function upload(u: Upload) {
    setData((d) => ({ ...d, uploads: [u, ...d.uploads] }));
    if (pendingUploads([u], 'api').length) {
      navigate('inbox');
      setModal('');
      notify('已收到客户端上下文，确认后可归档到手账。');
    } else {
      setModal(u.kind === 'summary' ? 'review-workbench' : 'review-link');
    }
  }
  function updateUpload(next: Upload) {
    setData((d) => ({
      ...d,
      uploads: d.uploads.map((u) => (u.id === next.id ? next : u)),
    }));
  }
  function removeUpload(id: string) {
    setData((d) => ({ ...d, uploads: d.uploads.filter((u) => u.id !== id) }));
  }
  function importUpload(u: Upload, target: string) {
    const imported = u.turns.map((t) => ({ ...t, id: uid() }));
    const fresh =
      target === 'new'
        ? {
            ...blankWorkspace(u.title, u.turns[0]?.source ?? '导入'),
            turns: imported,
          }
        : null;
    setData((d) => ({
      ...d,
      uploads: d.uploads.filter((x) => x.id !== u.id),
      workspaces: fresh
        ? [...d.workspaces, fresh]
        : d.workspaces.map((x) =>
            x.id === target ? { ...x, turns: [...x.turns, ...imported] } : x,
          ),
    }));
    openWorkspace(fresh?.id ?? target);
    setModal('');
    notify('对话已完整收进手账。');
  }
  function applySummary(u: Upload, target: Workspace, mode: 'keep' | 'rewind') {
    const s = {
      id: `candidate-${u.id}`,
      title: u.title,
      text: u.summaryText ?? '',
      covered: u.covered ?? [],
      createdAt: now(),
    };
    const next = restoreSummary(
      { ...target, summaries: [...target.summaries, s].slice(-30) },
      s.id,
      mode,
    );
    setData((d) => ({
      ...d,
      uploads: d.uploads.filter((x) => x.id !== u.id),
      workspaces: d.workspaces.map((x) => (x.id === next.id ? next : x)),
    }));
    setWorkspaceId(next.id);
    navigate('summary');
    setModal('');
    notify('候选摘要已设为活跃，原文处理水位按你的选择更新。');
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
  function saveTurn(turn: Turn) {
    if (editing)
      update({
        ...w,
        turns: w.turns.map((t) => (t.id === turn.id ? turn : t)),
      });
    else {
      const at = afterId ? w.turns.findIndex((t) => t.id === afterId) + 1 : 0;
      const turns = [...w.turns];
      turns.splice(at, 0, turn);
      update({ ...w, turns });
    }
    setModal('');
    notify('完整轮次已保存。');
  }
  if (!persistence.ready)
    return (
      <div className="loading-screen">
        <BookOpen size={38} />
        <h1>Context Hub</h1>
        <p>正在翻开你的手账…</p>
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
                        active={page === 'archive'}
                        onChange={update}
                        onInsert={insert}
                        onEdit={edit}
                      />
                    ) : panel === 'summary' ? (
                      <SummaryPage
                        w={w}
                        onChange={update}
                        onUpload={upload}
                        pendingCount={candidates.length}
                        onReview={() => setModal('review-workbench')}
                      />
                    ) : panel === 'notes' ? (
                      <NotesPage w={w} onChange={update} />
                    ) : panel === 'memory' ? (
                      <MemoryPage w={w} onChange={update} />
                    ) : panel === 'inbox' ? (
                      <InboxPage
                        uploads={deliveries}
                        workspaces={data.workspaces}
                        currentId={w.id}
                        onUpdate={updateUpload}
                        onRemove={removeUpload}
                        onImport={importUpload}
                        onSummary={applySummary}
                      />
                    ) : panel === 'connect' ? (
                      <ConnectionsPage w={w} onChange={update} />
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
          onCreate={(name, platform) => {
            const x = blankWorkspace(name, platform);
            setData((d) => ({ ...d, workspaces: [...d.workspaces, x] }));
            setModal('');
            openWorkspace(x.id);
          }}
        />
      )}{' '}
      {modal === 'import' && (
        <ImportDialog
          onUpload={upload}
          onClose={() => setModal('')}
          pendingCount={linkImports.length}
          onReview={() => setModal('review-link')}
        />
      )}{' '}
      {(modal === 'review-link' || modal === 'review-workbench') && (
        <Modal
          title={modal === 'review-link' ? '确认分享导入' : '确认候选摘要'}
          description={
            modal === 'review-link'
              ? '预览后选择手账归档；未确认的内容会保留在分享链接导入流程中。'
              : '确认后设为活跃摘要；未确认的候选会保留在当前手账的摘要工作台。'
          }
          onClose={() => setModal('')}
        >
          <div className="upload-review-dialog">
            <UploadReview
              key={`${modal}-${w.id}`}
              uploads={modal === 'review-link' ? linkImports : candidates}
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
            这是本地交互原型，使用示例账号。真实账号、接口与云端存储尚未连接。数据保存在当前浏览器中。
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
