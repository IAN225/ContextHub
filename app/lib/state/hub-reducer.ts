import { type HubCommand, type HubState } from './contracts.ts';
import { applyMcpEvents } from './reducers/mcp-events.ts';
import { applyNotifications } from './reducers/notifications.ts';
import { applyTaskResults } from './reducers/task-results.ts';
import { applyUploads } from './reducers/uploads.ts';
import { applyWorkspaceCommand } from './workspace-reducer.ts';

export function applyHubCommand(
  state: HubState,
  command: HubCommand,
): HubState {
  switch (command.type) {
    case 'notification/read':
      return applyNotifications(state, command);
    case 'mcp/receive':
      return applyMcpEvents(state, command, applyHubCommand);
    case 'task/workbench':
    case 'task/summary':
    case 'task/attachment':
      return applyTaskResults(state, command, applyHubCommand);
    case 'workspace': {
      const current = state.workspaces.find(
        (w) => w.id === command.workspaceId,
      );
      if (!current) throw new Error('工作区已不存在。');
      const next = applyWorkspaceCommand(current, command.command);
      return next === current
        ? state
        : {
            ...state,
            workspaces: state.workspaces.map((w) =>
              w.id === current.id ? next : w,
            ),
          };
    }
    case 'workspace/delete':
      return {
        ...state,
        workspaces: state.workspaces.filter(
          (w) => w.id !== command.workspaceId,
        ),
        uploads: state.uploads.filter(
          (u) => u.workspaceId !== command.workspaceId,
        ),
        noteNotifications: state.noteNotifications?.filter(
          (n) => n.workspaceId !== command.workspaceId,
        ),
      };
    case 'workspace/create':
      return state.workspaces.some((w) => w.id === command.workspace.id)
        ? state
        : { ...state, workspaces: [...state.workspaces, command.workspace] };
    case 'upload/add':
    case 'upload/receive':
    case 'upload/update':
    case 'upload/remove':
    case 'upload/archive':
    case 'upload/summary':
      return applyUploads(state, command);
  }
}
