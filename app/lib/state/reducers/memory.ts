import { type Workspace } from '../../core/model.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applyMemory(
  w: Workspace,
  command: Extract<WorkspaceCommand, { type: 'memory/set' }>,
): Workspace {
  switch (command.type) {
    case 'memory/set':
      return { ...w, blocks: command.blocks };
  }
}
