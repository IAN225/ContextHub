import {
  validateAttachments as attachments,
  validateBlocks as blocks,
} from './value-validation.ts';
import { validateAuxiliary } from './auxiliary.ts';
import type { DataRepository, StorageEntry } from './account-repository.ts';
import { type HubState } from '../state/contracts.ts';
import { normalizeHubState } from '../state/validation.ts';

export const BACKUP_LIMIT = 100 * 1024 * 1024;
export type HubBackup = {
  format: 'context-hub-backup';
  version: 1;
  createdAt: string;
  entries: StorageEntry[];
};
const HUB_KEY = 'hub-state-v1';
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function check(value: unknown): asserts value {
  if (!value) throw new Error('备份格式或内容不完整，当前数据未修改。');
}
function unique(items: { id: string }[]) {
  check(
    items.every((item) => typeof item.id === 'string' && item.id.length > 0),
  );
  check(new Set(items.map((item) => item.id)).size === items.length);
}
export function backupState(backup: HubBackup) {
  return normalizeHubState(
    backup.entries.find((entry) => entry.key === HUB_KEY)?.value,
  );
}
export function validateBackup(raw: unknown): HubBackup {
  check(
    object(raw) && raw.format === 'context-hub-backup' && raw.version === 1,
  );
  check(
    typeof raw.createdAt === 'string' &&
      Number.isFinite(Date.parse(raw.createdAt)),
  );
  check(Array.isArray(raw.entries) && raw.entries.length > 0);
  const entries: StorageEntry[] = raw.entries.map((entry: unknown) => {
    check(
      object(entry) &&
        typeof entry.key === 'string' &&
        !entry.key.startsWith('__') &&
        entry.value !== undefined,
    );
    if (entry.key !== HUB_KEY)
      return {
        key: entry.key,
        value: validateAuxiliary(entry.key, entry.value),
      };
    return { key: entry.key, value: entry.value };
  });
  check(new Set(entries.map((entry) => entry.key)).size === entries.length);
  const state = normalizeHubState(
    entries.find((entry) => entry.key === HUB_KEY)?.value,
  );
  unique(state.workspaces);
  unique(state.uploads);
  const turns = [
    ...state.workspaces.flatMap((w) => w.turns),
    ...state.uploads.flatMap((u) => u.turns),
  ];
  for (const turn of turns) {
    check(turn.time === null || typeof turn.time === 'string');
    if (turn.attachments !== undefined) attachments(turn.attachments);
  }
  for (const w of state.workspaces) {
    unique(w.turns);
    unique(w.notes);
    for (const track of [w, w.reme, w.client]) {
      if (!track) continue;
      unique(track.summaries);
      check(Number.isInteger(track.retain) && track.retain >= 1);
      check(
        track.activeId === null ||
          track.summaries.some((s) => s.id === track.activeId),
      );
      check(
        track.watermark === null ||
          w.turns.some((t) => t.id === track.watermark),
      );
      validateAuxiliary('model-draft-validation', track.config);
    }
    unique(w.blocks);
    for (const n of w.notes) {
      check(
        ['createdAt', 'updatedAt', 'editor', 'source'].every(
          (key) =>
            typeof (n as unknown as Record<string, unknown>)[key] === 'string',
        ),
      );
      check(
        n.versions.every(
          (v) =>
            object(v) &&
            ['title', 'body', 'time'].every(
              (key) =>
                typeof (v as unknown as Record<string, unknown>)[key] ===
                'string',
            ),
        ),
      );
    }
    blocks(w.blocks);
    check(
      w.tokens.every(
        (t) =>
          object(t) &&
          ['id', 'name', 'value', 'createdAt', 'expiresAt', 'kind'].every(
            (key) =>
              typeof (t as unknown as Record<string, unknown>)[key] ===
              'string',
          ),
      ),
    );
  }
  return {
    format: 'context-hub-backup',
    version: 1,
    createdAt: raw.createdAt,
    entries: entries.map((entry) =>
      entry.key === HUB_KEY ? { ...entry, value: state } : entry,
    ),
  };
}
export function parseBackup(text: string) {
  if (new TextEncoder().encode(text).length > BACKUP_LIMIT)
    throw new Error('备份超过 100 MB，请先拆分数据。');
  try {
    return validateBackup(
      JSON.parse(text, (key, value: unknown) => {
        check(!['__proto__', 'prototype', 'constructor'].includes(key));
        return value;
      }),
    );
  } catch {
    throw new Error(
      '无法读取这个备份：文件损坏、格式不符或版本不受支持。当前数据未修改。',
    );
  }
}
export async function createBackup(
  repository: DataRepository,
  current?: HubState,
): Promise<HubBackup> {
  const entries = await repository.entries();
  if (current) {
    const index = entries.findIndex((entry) => entry.key === HUB_KEY);
    const entry = { key: HUB_KEY, value: structuredClone(current) };
    if (index < 0) entries.push(entry);
    else entries[index] = entry;
  }
  return validateBackup({
    format: 'context-hub-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    entries,
  });
}
export async function restoreBackup(
  repository: DataRepository,
  backup: HubBackup,
  at = new Date().toISOString(),
) {
  const validated = validateBackup(structuredClone(backup));
  const state = backupState(validated);
  await repository.replace((current) => {
    const old = current.find((entry) => entry.key === HUB_KEY)?.value;
    const oldReceipts =
      object(old) && Array.isArray(old.deliveryReceipts)
        ? old.deliveryReceipts.filter(
            (id): id is string => typeof id === 'string',
          )
        : [];
    const restored = {
      ...state,
      mcpReceipts: [
        ...new Set([
          ...(object(old) && Array.isArray(old.mcpReceipts)
            ? old.mcpReceipts.filter(
                (id): id is string => typeof id === 'string',
              )
            : []),
          ...(state.mcpReceipts ?? []),
        ]),
      ],
      deliveryReceipts: [
        ...new Set([...oldReceipts, ...(state.deliveryReceipts ?? [])]),
      ],
      // Give restored trash 30 days for review; retain its original deletion date.
      trashRestoredAt: at,
      workspaces: state.workspaces.map((w) => ({
        ...w,
        config: { ...w.config, auto: false },
        ...(w.reme
          ? { reme: { ...w.reme, config: { ...w.reme.config, auto: false } } }
          : {}),
        ...(w.client
          ? {
              client: {
                ...w.client,
                config: {
                  ...w.client.config,
                  auto: false,
                  configured: false,
                  modelEnabled: false,
                },
              },
            }
          : {}),
      })),
    };
    return [
      ...validated.entries.filter(
        (entry) => ![HUB_KEY, 'delivery-connection-v1'].includes(entry.key),
      ),
      { key: HUB_KEY, value: restored },
      { key: 'delivery-connection-v1', value: { connected: false } },
    ];
  });
}
export function backupCounts(state: HubState) {
  return {
    workspaces: state.workspaces.length,
    turns: state.workspaces.reduce((n, w) => n + w.turns.length, 0),
    notes: state.workspaces.reduce((n, w) => n + w.notes.length, 0),
    uploads: state.uploads.length,
  };
}
