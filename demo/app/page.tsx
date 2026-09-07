'use client';
import { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowLeft,
  Plus,
  Search,
  Inbox,
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
import { ImportDialog, InboxPage } from '@/components/hub/inbox';
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
  type Workspace,
  type Turn,
  type Upload,
} from '@/lib/domain';
const navigation = [
  { id: 'archive', label: '原文', sub: '对话长卷', icon: MessageSquare },
  { id: 'summary', label: '摘要', sub: '记忆摘记', icon: Layers },
  { id: 'notes', label: 'Note', sub: '随手便签', icon: StickyNote },
  { id: 'memory', label: '记忆包', sub: '带去下一页', icon: PackageOpen },
  { id: 'connect', label: '连接', sub: '书册设置', icon: Plug },
];
export default function Hub() {
  const initial = useMemo(() => createSeed(), []);
  const [data, setData, persistence] = usePersistent('hub-state-v1', initial);
  const [workspaceId, setWorkspaceId] = useState('ws-everyday'),
    [page, setPage] = useState('archive'),
    [visitedPages, setVisitedPages] = useState(['archive']),
    [home, setHome] = useState(true),
    [modal, setModal] = useState(''),
    [afterId, setAfterId] = useState<string | null>(null),
    [editing, setEditing] = useState<Turn | undefined>(),
    [notice, setNotice] = useState('');
  const w =
    data.workspaces.find((w) => w.id === workspaceId) ?? data.workspaces[0];
  useDemoMemoryTools(w);
  const main = useRef<HTMLElement>(null);
  const chapterScroll = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    if (main.current)
      main.current.scrollTop = chapterScroll.current[`${w.id}-${page}`] ?? 0;
  }, [page, w.id, home]);
  function transition(fn: () => void) {
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
  }
  function openWorkspace(id: string) {
    transition(() => {
      setWorkspaceId(id);
      setPage('archive');
      setVisitedPages(['archive']);
      setHome(false);
    });
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
    notify('候选内容已放入收件箱，可以预览后决定如何使用。');
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
      {home ? (
        <JournalHome
          workspaces={data.workspaces}
          uploads={data.uploads.length}
          onOpen={openWorkspace}
          onNew={() => setModal('new-workspace')}
          onInbox={() => navigate('inbox')}
          onSearch={() => navigate('search')}
          onAccount={() => setModal('account')}
        />
      ) : (
        <div className="open-journal">
          <header className="journal-reader-header">
            <button
              className="back-to-shelf"
              onClick={() => transition(() => setHome(true))}
            >
              <ArrowLeft size={16} />
              <span>我的手账</span>
            </button>
            <div className="reader-breadcrumb">
              <span>{w.name}</span>
              <ChevronRight size={13} />
              <span>
                {navigation.find((n) => n.id === page)?.label ??
                  (page === 'inbox' ? '收件箱' : '寻找记忆')}
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
              <button
                className="icon-button"
                aria-label="收件箱"
                onClick={() => navigate('inbox')}
              >
                <Inbox size={17} />
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
              <div className="journal-chapter">
                <span>
                  <BookOpen size={16} />
                  {w.name}
                </span>
                <small>一本持续生长的对话手账</small>
              </div>
              <nav className="journal-tabs" aria-label="手账章节">
                {navigation.map((n) => (
                  <button
                    key={n.id}
                    className={page === n.id ? 'selected' : ''}
                    aria-current={page === n.id ? 'page' : undefined}
                    onClick={() => navigate(n.id)}
                  >
                    <n.icon size={15} />
                    <span>
                      {n.label}
                      <small>{n.sub}</small>
                    </span>
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
                      <SummaryPage w={w} onChange={update} onUpload={upload} />
                    ) : panel === 'notes' ? (
                      <NotesPage w={w} onChange={update} />
                    ) : panel === 'memory' ? (
                      <MemoryPage w={w} onChange={update} />
                    ) : panel === 'inbox' ? (
                      <InboxPage
                        uploads={data.uploads}
                        workspaces={data.workspaces}
                        currentId={w.id}
                        onUploads={(uploads) =>
                          setData((d) => ({ ...d, uploads }))
                        }
                        onImport={importUpload}
                        onSummary={applySummary}
                        onNewImport={() => setModal('import')}
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
          onPaste={() => insert(w.turns.at(-1)?.id ?? null)}
          onClose={() => setModal('')}
        />
      )}{' '}
      {modal === 'account' && (
        <Modal title="这本手账，只在此处" onClose={() => setModal('')}>
          <p className="callout">
            这是本地交互原型，使用示例账号。真实账号、接口与云端存储尚未连接。数据保存在当前浏览器中。
          </p>
        </Modal>
      )}
      {notice && (
        <output className="journal-toast">
          <Check size={16} />
          {notice}
        </output>
      )}
    </div>
  );
}
