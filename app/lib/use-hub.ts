'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { purgeTrash, trashCounts } from './recycle-bin';
import type { StorageEntry } from './repository';
import { type HubCommand, type WorkspaceCommand } from './state/contracts.ts';
import { createEmptyHubState } from './state/empty.ts';
import { applyHubCommand } from './state/hub-reducer.ts';
import { normalizeHubState } from './state/validation.ts';
import { usePersistent } from './store';
import { removeWorkspaceData } from './workspace-lifecycle';
export type CommitWorkspaceCommand = (
  command: WorkspaceCommand,
  companion?: StorageEntry,
) => Promise<boolean>;

export function useHub() {
  const [initial] = useState(createEmptyHubState);
  const [data, update, persistence] = usePersistent('hub-state-v1', initial, {
    normalize: normalizeHubState,
  });
  const dispatch = useCallback(
    (command: HubCommand) => {
      update((current) => applyHubCommand(current, command));
    },
    [update],
  );
  const commitValue = persistence.commit;
  const commit = useCallback(
    (command: HubCommand, companion?: StorageEntry) =>
      commitValue(
        (current) => applyHubCommand(current, command),
        companion ? [companion] : [],
      ),
    [commitValue],
  );
  const latest = useRef(data);
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  const transact = persistence.transact;
  const removeWorkspace = useCallback(
    (id: string) => transact((current) => removeWorkspaceData(current, id)),
    [transact],
  );
  const cleanup = useCallback(
    async (mode: 'expired' | 'all') => {
      const at = Date.now();
      const counts = trashCounts(latest.current, at);
      if (!(mode === 'all' ? counts.total : counts.expired)) return 0;
      let count = 0;
      const saved = await transact((current) => {
        const result = purgeTrash(current, mode, at);
        count = result.count;
        return { value: result.state, companions: result.drafts };
      });
      if (!saved) throw new Error('回收站清理未能保存，请稍后重试。');
      return count;
    },
    [transact],
  );
  useEffect(() => {
    if (!persistence.ready) return;
    const sweep = () => {
      void cleanup('expired').catch(() => {});
    };
    sweep();
    const timer = setInterval(sweep, 60 * 60 * 1000);
    window.addEventListener('focus', sweep);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', sweep);
    };
  }, [persistence.ready, cleanup]);
  return { data, persistence, dispatch, commit, cleanup, removeWorkspace };
}
