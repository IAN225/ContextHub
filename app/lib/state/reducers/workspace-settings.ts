import { type Workspace } from '../../core/model.ts';
import { validAppearance } from '../../workspaces/appearance.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applyWorkspaceSettings(
  w: Workspace,
  command: Extract<
    WorkspaceCommand,
    { type: 'workspace/settings' | 'workspace/rename' }
  >,
): Workspace {
  switch (command.type) {
    case 'workspace/settings':
      if (!validAppearance(command.appearance))
        throw Error('工作区外观设置无效。');
      return {
        ...w,
        name: command.name.trim() || w.name,
        appearance: command.appearance,
      };
    case 'workspace/rename':
      return { ...w, name: command.name.trim() || w.name };
  }
}
