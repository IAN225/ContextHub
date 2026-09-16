import { type Workspace } from '../../core/model.ts';
import { type WorkspaceCommand } from '../contracts.ts';

export function applyTokens(
  w: Workspace,
  command: Extract<
    WorkspaceCommand,
    { type: 'token/create' | 'token/revoke' | 'token/rotate' }
  >,
): Workspace {
  switch (command.type) {
    case 'token/create':
      return { ...w, tokens: [...w.tokens, command.token] };
    case 'token/revoke':
      return {
        ...w,
        tokens: w.tokens.map((t) =>
          t.id === command.tokenId ? { ...t, revoked: true } : t,
        ),
      };
    case 'token/rotate':
      return {
        ...w,
        tokens: [
          ...w.tokens.map((t) =>
            t.id === command.tokenId ? { ...t, revoked: true } : t,
          ),
          command.token,
        ],
      };
  }
}
