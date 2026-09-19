import { type Workspace } from '../core/model.ts';
import {
  parseSummaryEngine,
  summaryTrack,
  summaryWorkspace,
} from '../summary/engines.ts';
import { type WorkspaceCommand } from './contracts.ts';
import { applyMemory } from './reducers/memory.ts';
import { applyNotes } from './reducers/notes.ts';
import { applySummaries } from './reducers/summaries.ts';
import { applyTurns } from './reducers/turns.ts';
import { applyWorkspaceSettings } from './reducers/workspace-settings.ts';

export function applyWorkspaceCommand(
  w: Workspace,
  command: WorkspaceCommand,
): Workspace {
  if (command.type === 'summary/tab')
    return { ...w, summaryTab: parseSummaryEngine(command.value) };
  if (command.type === 'memory/engine')
    return { ...w, memoryEngine: parseSummaryEngine(command.value) };
  const engine =
    command.type === 'summary/generated'
      ? (command.generated.engine ?? command.engine)
      : command.engine;
  if (
    command.type === 'summary/config' ||
    command.type === 'summary/retain' ||
    command.type === 'summary/generated' ||
    command.type === 'summary/restore'
  ) {
    const next = applySummaries(
      summaryWorkspace(w, engine ?? 'custom'),
      command,
    );
    return engine === 'reme'
      ? { ...w, reme: summaryTrack(next) }
      : { ...w, ...summaryTrack(next) };
  }
  switch (command.type) {
    case 'workspace/settings':
    case 'workspace/rename':
      return applyWorkspaceSettings(w, command);
    case 'turn/save':
    case 'turn/status':
      return applyTurns(w, command);
    case 'note/create':
    case 'note/save':
    case 'note/replace':
    case 'note/star':
    case 'note/status':
      return applyNotes(w, command);
    case 'memory/set':
      return applyMemory(w, command);
  }
}
