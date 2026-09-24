import { type HubState } from '../state/contracts.ts';
import { applyHubCommand } from '../state/hub-reducer.ts';
import { workspaceDraftKeys } from './draft-keys.ts';
export function removeWorkspaceData(state: HubState, workspaceId: string) {
  const w = state.workspaces.find((w) => w.id === workspaceId);
  return {
    value: applyHubCommand(state, { type: 'workspace/delete', workspaceId }),
    companions: (w ? workspaceDraftKeys(w) : []).map((key) => ({
      key,
      value: undefined,
    })),
  };
}
