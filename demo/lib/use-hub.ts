'use client';
import { useCallback, useState } from 'react';
import { createSeed } from './seed';
import { usePersistent } from './store';
import {
  applyHubCommand,
  normalizeHubState,
  type HubCommand,
  type WorkspaceCommand,
} from './hub-state';
import type { StorageEntry } from './repository';
export type CommitWorkspaceCommand = (
  command: WorkspaceCommand,
  companion?: StorageEntry,
) => Promise<boolean>;

export function useHub() {
  const [initial] = useState(() => normalizeHubState(createSeed()));
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
  return { data, persistence, dispatch, commit };
}
