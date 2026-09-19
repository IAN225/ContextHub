import type { HubCommand, HubState } from '../state/contracts.ts';
export type RevisionMap = Record<string, number>;
export type AccountSnapshot = {
  state: HubState;
  generation: number;
  revisions: RevisionMap;
};
export type ApplicationCommand =
  | HubCommand
  | { type: 'trash/purge'; mode: 'all' | 'expired' };
export type CommandRequest = {
  id: string;
  generation: number;
  expected: RevisionMap;
  command: ApplicationCommand;
  companion?: { key: string; value: unknown; revision: number };
};
