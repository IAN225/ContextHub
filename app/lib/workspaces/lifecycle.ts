import { type HubState } from '../state/contracts.ts';
import { applyHubCommand } from '../state/hub-reducer.ts';
export function removeWorkspaceData(state: HubState, workspaceId: string) {
  const w = state.workspaces.find((w) => w.id === workspaceId);
  const keys = w
    ? [
        'connection-draft-' + w.id,
        'new-note-' + w.id,
        'workbench-' + w.id,
        ...['model-draft-', 'model-probes-v2-'].flatMap((prefix) => [
          prefix + w.id,
          prefix + w.id + '-reme',
        ]),
        ...['start', ...w.turns.map((t) => t.id)].map(
          (id) => 'turn-draft-' + w.id + '-' + id,
        ),
        ...w.notes.map((n) => 'note-draft-' + w.id + '-' + n.id),
      ]
    : [];
  return {
    value: applyHubCommand(state, { type: 'workspace/delete', workspaceId }),
    companions: keys.map((key) => ({ key, value: undefined })),
  };
}
