'use client';
import { useState } from 'react';
import { useViewScope } from '../../lib/client/use-view-scope';
import type { Turn, Workspace } from '../../lib/core/model';
import type { StorageEntry } from '../../lib/storage/account-repository';
import type { CommitWorkspaceCommand } from '../../lib/application/use-hub';
export function useTurnEditor(
  workspace: Workspace,
  commit: CommitWorkspaceCommand,
  capture: () => () => boolean,
  open: () => void,
  saved: () => void,
) {
  const captureWorkspace = useViewScope(workspace.id);
  const [entry, setEntry] = useState<{
    workspaceId: string;
    editing?: Turn;
    afterId: string | null;
  }>({ workspaceId: workspace.id, afterId: null });
  const current =
    entry.workspaceId === workspace.id
      ? entry
      : { workspaceId: workspace.id, afterId: null, editing: undefined };
  return {
    editing: current.editing,
    afterId: current.afterId,
    edit(this: void, turn: Turn) {
      setEntry({ workspaceId: workspace.id, editing: turn, afterId: null });
      open();
    },
    insert(this: void, afterId: string | null) {
      setEntry({ workspaceId: workspace.id, afterId });
      open();
    },
    async saveTurn(this: void, turn: Turn, companion: StorageEntry) {
      if (
        current.editing &&
        JSON.stringify(
          workspace.turns.find((t) => t.id === current.editing!.id),
        ) !== JSON.stringify(current.editing)
      )
        throw new Error('原文已更新，请保留草稿后重新打开编辑。');
      const isCurrent = capture();
      const sameWorkspace = captureWorkspace();
      const result = await commit(
        {
          type: 'turn/save',
          turn,
          insert: !current.editing,
          afterId: current.afterId,
        },
        companion,
      );
      if (result && isCurrent() && sameWorkspace()) saved();
      return result;
    },
  };
}
