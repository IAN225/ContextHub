import { attachmentRevision } from '../../attachments/content.ts';
import { type Turn } from '../../core/model.ts';
import { type HubCommand, type HubState } from '../contracts.ts';

export function applyTaskResults(
  state: HubState,
  command: Extract<
    HubCommand,
    { type: 'task/workbench' | 'task/summary' | 'task/attachment' }
  >,
  dispatch: (state: HubState, command: HubCommand) => HubState,
): HubState {
  switch (command.type) {
    case 'task/workbench':
    case 'task/summary':
    case 'task/attachment': {
      const received = state.taskReceipts?.[command.taskId] ?? 0;
      if (received >= command.step) return state;
      if (command.step !== received + 1)
        throw new Error('后台结果需要按顺序接收。');
      let next = state;
      if (command.type === 'task/workbench') {
        next = dispatch(state, {
          type: 'upload/add',
          upload: command.upload,
        });
      } else if (command.type === 'task/summary') {
        next = dispatch(state, {
          type: 'workspace',
          workspaceId: command.workspaceId,
          command: { type: 'summary/generated', generated: command.generated },
        });
      } else {
        const patch = (turns: Turn[]) =>
          turns.map((t) =>
            t.status === 'trash' ||
            !t.attachments?.some(
              (a) =>
                a.id === command.attachment.id &&
                attachmentRevision(a) === command.expected,
            )
              ? t
              : {
                  ...t,
                  attachments: t.attachments.map((a) =>
                    a.id === command.attachment.id &&
                    attachmentRevision(a) === command.expected
                      ? command.attachment
                      : a,
                  ),
                },
          );
        next = {
          ...state,
          workspaces: state.workspaces.map((w) => ({
            ...w,
            turns: patch(w.turns),
          })),
          uploads: state.uploads.map((u) => ({ ...u, turns: patch(u.turns) })),
        };
      }
      return {
        ...next,
        taskReceipts: { ...state.taskReceipts, [command.taskId]: command.step },
      };
    }
  }
}
