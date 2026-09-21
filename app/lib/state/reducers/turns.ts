import { preserveFetchedAttachments } from '../../attachments/content.ts';
import { type Workspace } from '../../core/model.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applyTurns(
  w: Workspace,
  command: Extract<WorkspaceCommand, { type: 'turn/save' | 'turn/status' }>,
): Workspace {
  switch (command.type) {
    case 'turn/save': {
      const current = w.turns.find((t) => t.id === command.turn.id);
      if (!command.insert) {
        if (!current) throw new Error('需要编辑的原文轮次已不存在。');
        const { source, messages, attachments } = command.turn;
        return {
          ...w,
          turns: w.turns.map((t) =>
            t.id === current.id
              ? {
                  ...t,
                  source,
                  messages,
                  attachments: preserveFetchedAttachments(
                    attachments,
                    t.attachments,
                  ),
                }
              : t,
          ),
        };
      }
      if (current) return w;
      const at =
        command.afterId === null
          ? -1
          : w.turns.findIndex((t) => t.id === command.afterId);
      if (command.afterId !== null && at < 0)
        throw new Error('原文插入位置已不存在。');
      const turns = [...w.turns];
      turns.splice(at + 1, 0, command.turn);
      return { ...w, turns };
    }
    case 'turn/status':
      return {
        ...w,
        turns: w.turns.map((t) =>
          t.id === command.turnId
            ? {
                ...t,
                status: command.status,
                deletedAt: command.status === 'trash' ? command.at : undefined,
              }
            : t,
        ),
      };
  }
}
