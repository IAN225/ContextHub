import { randomId } from '../browser-compat.ts';
import { createEmptyHubState } from '../state/empty.ts';
import { normalizeHubState } from '../state/validation.ts';
import { workspaceDraftKeys } from '../workspaces/draft-keys.ts';
import type { DataRepository } from './account-repository.ts';
import { backupState, validateBackup, type HubBackup } from './backup.ts';

const HUB_KEY = 'hub-state-v1';

export function selectBackupWorkspaces(
  backup: HubBackup,
  workspaceIds: readonly string[],
): HubBackup {
  const validated = validateBackup(structuredClone(backup));
  const state = backupState(validated);
  const ids = new Set(workspaceIds);
  if (
    !ids.size ||
    [...ids].some((id) => !state.workspaces.some((w) => w.id === id))
  )
    throw new Error('请至少选择一个有效工作区。');
  const workspaces = state.workspaces
    .filter((w) => ids.has(w.id))
    .map((w) => ({ ...w, tokens: [] }));
  const keys = new Set(workspaces.flatMap(workspaceDraftKeys));
  return validateBackup({
    ...validated,
    entries: [
      {
        key: HUB_KEY,
        value: {
          schemaVersion: 1,
          workspaces,
          uploads: state.uploads.filter(
            (u) => u.workspaceId && ids.has(u.workspaceId),
          ),
          noteNotifications: (state.noteNotifications ?? []).filter((n) =>
            ids.has(n.workspaceId),
          ),
          ...(state.trashRestoredAt
            ? { trashRestoredAt: state.trashRestoredAt }
            : {}),
        },
      },
      ...validated.entries.filter((e) => keys.has(e.key)),
    ],
  });
}

/** Append copies through ordinary guarded writes; existing tasks and connections stay intact. */
export async function importBackupWorkspaces(
  repository: DataRepository,
  backup: HubBackup,
  workspaceIds: readonly string[],
  at = new Date().toISOString(),
) {
  const selected = selectBackupWorkspaces(backup, workspaceIds);
  const source = backupState(selected);
  const current = normalizeHubState(
    (await repository.read(HUB_KEY)) ?? createEmptyHubState(),
  );
  const ids = new Map(source.workspaces.map((w) => [w.id, randomId()]));
  const keyMap = new Map<string, string>();
  const workspaces = source.workspaces.map((w) => {
    const next = {
      ...w,
      id: ids.get(w.id)!,
      tokens: [],
      config: {
        ...w.config,
        configured: false,
        modelEnabled: false,
        auto: false,
      },
      ...(w.reme
        ? {
            reme: {
              ...w.reme,
              config: {
                ...w.reme.config,
                configured: false,
                modelEnabled: false,
                auto: false,
              },
            },
          }
        : {}),
      ...(w.client
        ? {
            client: {
              ...w.client,
              config: {
                ...w.client.config,
                configured: false,
                modelEnabled: false,
                auto: false,
              },
            },
          }
        : {}),
      turns: w.turns.map((t) =>
        t.status === 'trash' ? { ...t, deletedAt: at } : t,
      ),
      notes: w.notes.map((n) =>
        n.status === 'trash' ? { ...n, deletedAt: at } : n,
      ),
    };
    const nextKeys = workspaceDraftKeys(next);
    workspaceDraftKeys(w).forEach((key, index) =>
      keyMap.set(key, nextKeys[index]),
    );
    return next;
  });
  await repository.write([
    {
      key: HUB_KEY,
      value: {
        ...current,
        workspaces: [...current.workspaces, ...workspaces],
        uploads: [
          ...current.uploads,
          ...source.uploads.map((u) => ({
            ...u,
            id: randomId(),
            workspaceId: ids.get(u.workspaceId!),
          })),
        ],
        noteNotifications: [
          ...(current.noteNotifications ?? []),
          ...(source.noteNotifications ?? []).map((n) => ({
            ...n,
            id: randomId(),
            workspaceId: ids.get(n.workspaceId)!,
          })),
        ],
      },
    },
    ...selected.entries
      .filter((e) => keyMap.has(e.key))
      .map((e) => ({
        key: keyMap.get(e.key)!,
        value: e.key.startsWith('model-draft-')
          ? {
              ...(e.value as object),
              configured: false,
              modelEnabled: false,
              auto: false,
            }
          : e.value,
      })),
  ]);
}
