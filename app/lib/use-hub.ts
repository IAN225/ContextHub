'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createApplicationSession } from './application/client-session';
import { trashCounts } from './recycle-bin';
import { accountRepository, type StorageEntry } from './repository';
import type { HubCommand, WorkspaceCommand } from './state/contracts';
export type CommitWorkspaceCommand = (
  command: WorkspaceCommand,
  companion?: StorageEntry,
) => Promise<boolean>;
export function useHub() {
  const [session] = useState(() => createApplicationSession());
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getServerSnapshot,
  );
  useEffect(() => {
    void session.refresh();
    const timer = setInterval(() => {
      void session.refresh();
    }, 2500);
    const focus = () => {
      void session.refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [session]);
  const commit = useCallback(
    async (command: HubCommand, companion?: StorageEntry) => {
      if (!companion) return session.commit(command);
      return accountRepository.commitEntry!(companion, (revision, applied) =>
        session.commit(command, { ...companion, revision }, applied),
      );
    },
    [session],
  );
  const dispatch = useCallback(
    (command: HubCommand) => {
      void commit(command);
    },
    [commit],
  );
  const removeWorkspace = useCallback(
    (id: string) =>
      session.commit({ type: 'workspace/delete', workspaceId: id }),
    [session],
  );
  const cleanup = useCallback(
    async (mode: 'all' | 'expired') => {
      const count = trashCounts(session.getSnapshot().data);
      if (!(await session.commit({ type: 'trash/purge', mode })))
        throw new Error('清理失败，请重试。');
      return mode === 'all' ? count.total : count.expired;
    },
    [session],
  );
  return {
    data: state.data,
    dispatch,
    commit,
    cleanup,
    removeWorkspace,
    persistence: {
      ready: state.ready,
      saved: state.saved,
      busy: state.busy,
      error: state.error,
      retry: () => session.retry(),
    },
    refresh: session.refresh,
  };
}
