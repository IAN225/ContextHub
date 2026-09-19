'use client';
import { useCallback, useEffect, useState } from 'react';
import { now, uid } from '../../lib/core/identity.ts';
import { type Upload, type Workspace } from '../../lib/core/model.ts';
import { inboxUploads, pendingUploads } from '../../lib/imports/queue.ts';
import { useDeliveryInbox } from '../../lib/imports/use-delivery-inbox.ts';
import { useMcp } from '../../lib/mcp/use-mcp.ts';
import type { StorageEntry } from '../../lib/storage/account-repository.ts';
import { type WorkspaceCommand } from '../../lib/state/contracts.ts';
import { useBackgroundTasks } from '../../lib/tasks/use-background-tasks.ts';
import { useHub } from '../../lib/application/use-hub.ts';
import { blankWorkspace } from '../../lib/workspaces/create.ts';
import { useViewScope } from '../../lib/client/use-view-scope';
import { useTurnEditor } from './use-turn-editor';
import { useJournalNavigation } from './use-navigation.ts';
export function useWorkspaceController() {
  const {
    data,
    persistence,
    dispatch,
    commit,
    cleanup,
    removeWorkspace,
    refresh,
  } = useHub();
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
  const captureView = useViewScope(
    JSON.stringify([workspaceId, modal, page, home]),
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const deliveries = inboxUploads(data.uploads);
  const noteNotifications = data.noteNotifications ?? [];
  const directImports = pendingUploads(data.uploads, 'manual');
  const candidates = pendingUploads(data.uploads, 'workbench', w.id);
  const deliveryInbox = useDeliveryInbox(persistence.ready && modal !== 'data');
  const background = useBackgroundTasks(
    data,
    persistence.ready && modal !== 'data',
  );
  const mcp = useMcp(persistence.ready && modal !== 'data');
  function notify(text: string) {
    setNotice(text);
  }
  function updateUpload(next: Upload) {
    dispatch({ type: 'upload/update', upload: next });
  }
  async function importConversation(u: Upload) {
    const isCurrent = captureView();
    const saved = await commit({ type: 'upload/add', upload: u });
    if (saved && isCurrent()) {
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
    const isCurrent = captureView();
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
      if (isCurrent()) notify('归档失败，待归档内容已保留。');
      return false;
    }
    if (isCurrent()) {
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
    const isCurrent = captureView();
    const saved = await commit({
      type: 'upload/summary',
      uploadId: u.id,
      workspaceId: target.id,
      mode,
      at: now(),
    });
    if (!saved) {
      if (isCurrent()) notify('摘要保存失败，候选内容已保留。');
      return false;
    }
    if (isCurrent()) {
      setWorkspaceId(target.id);
      navigate('summary');
      setModal('');
      notify('候选摘要已设为活跃，原文处理水位按你的选择更新。');
    }
    return true;
  }
  const editor = useTurnEditor(
    w,
    commitWorkspace,
    captureView,
    () => setModal('turn'),
    () => {
      setModal('');
      notify('完整轮次已保存。');
    },
  );

  async function deleteWorkspace() {
    const isCurrent = captureView();
    const saved = await removeWorkspace(w.id);
    if (saved) {
      mcp.refresh();
      if (isCurrent()) transition(() => setHome(true));
    }
    return saved;
  }
  async function createWorkspace(
    name: string,
    platform: string,
    companion: StorageEntry,
  ) {
    const isCurrent = captureView();
    const x = blankWorkspace(name, platform);
    const saved = await commit(
      { type: 'workspace/create', workspace: x },
      companion,
    );
    if (saved && isCurrent()) {
      setModal('');
      openWorkspace(x.id);
    }
    return saved;
  }
  return {
    refresh,
    deleteWorkspace,
    createWorkspace,
    data,
    persistence,
    dispatch,
    cleanup,
    emptyWorkspace,
    workspaceId,
    page,
    visitedPages,
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
    onWorkspaceCommand,
    commitWorkspace,
    deliveries,
    noteNotifications,
    directImports,
    candidates,
    deliveryInbox,
    background,
    mcp,
    updateUpload,
    importConversation,
    removeUpload,
    importUpload,
    applySummary,
    ...editor,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>;
