import { receiveMcpNote } from '../../mcp/receive.ts';
import { type HubCommand, type HubState } from '../contracts.ts';

export function applyMcpEvents(
  state: HubState,
  command: Extract<HubCommand, { type: 'mcp/receive' }>,
  dispatch: (state: HubState, command: HubCommand) => HubState,
): HubState {
  switch (command.type) {
    case 'mcp/receive': {
      let workspace = state.workspaces.find(
        (w) => w.id === command.workspaceId,
      );
      if (!workspace)
        throw new Error('工作区已不存在，MCP 变更保留在本机服务中。');
      const receipts = new Set(state.mcpReceipts ?? []);
      let next = state;
      for (const event of command.events) {
        if (receipts.has(event.id)) continue;
        if (event.kind === 'note') {
          workspace = receiveMcpNote(workspace, event);
          if (event.before === null) {
            next = {
              ...next,
              noteNotifications: [
                {
                  id: event.id,
                  workspaceId: workspace.id,
                  workspaceName: workspace.name,
                  noteId: event.note.id,
                  title: event.note.title,
                  clientName: event.note.editor,
                  createdAt: event.note.createdAt,
                  read: false,
                },
                ...(next.noteNotifications ?? []),
              ],
            };
          }
        } else
          next = dispatch(next, {
            type: 'upload/receive',
            uploads: [event.upload],
          });
        receipts.add(event.id);
      }
      if (
        workspace ===
          state.workspaces.find((w) => w.id === command.workspaceId) &&
        receipts.size === (state.mcpReceipts?.length ?? 0)
      )
        return next;
      return {
        ...next,
        workspaces: next.workspaces.map((w) =>
          w.id === command.workspaceId ? workspace! : w,
        ),
        mcpReceipts: [...receipts],
      };
    }
  }
}
