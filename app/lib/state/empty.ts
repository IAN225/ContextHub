import { type HubState } from './contracts.ts';

export function createEmptyHubState(): HubState {
  return {
    schemaVersion: 1,
    workspaces: [],
    uploads: [],
    deliveryReceipts: [],
  };
}
