import { type HubCommand, type HubState } from '../contracts.ts';

export function applyNotifications(
  state: HubState,
  command: Extract<HubCommand, { type: 'notification/read' }>,
): HubState {
  switch (command.type) {
    case 'notification/read':
      return {
        ...state,
        noteNotifications: (state.noteNotifications ?? []).map((item) =>
          item.id === command.notificationId ? { ...item, read: true } : item,
        ),
      };
  }
}
