import { normalizeHubState, type HubState } from './hub-state.ts';
import type { DataRepository, StorageEntry } from './repository.ts';
import { dataUrlBytes, MAX_ATTACHMENT_TEXT } from './attachments.ts';

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
function fields(value: Record<string, unknown>, keys: string[], type: string) {
  for (const key of keys)
    check(value[key] === undefined || typeof value[key] === type);
}
function blocks(value: unknown) {
  check(Array.isArray(value));
  for (const b of value) {
    check(object(b) && typeof b.id === 'string');
    check(['text', 'summary', 'recent', 'stars'].includes(String(b.type)));
    fields(b, ['text'], 'string');
    fields(b, ['custom'], 'boolean');
    check(b.windowLength === undefined || Number.isFinite(b.windowLength));
    check(
      b.noteIds === undefined ||
        (Array.isArray(b.noteIds) &&
          b.noteIds.every((id) => typeof id === 'string')),
    );
  }
}
function attachments(value: unknown) {
  check(Array.isArray(value));
  for (const a of value) {
    check(
      object(a) &&
        ['id', 'name', 'type', 'url'].every(
          (key) => typeof a[key] === 'string',
        ),
    );
    fields(a, ['sourceUrl', 'reference', 'sha256', 'text', 'error'], 'string');
    check(
      a.status === undefined ||
        (typeof a.status === 'string' &&
          ['stored', 'remote', 'missing', 'failed'].includes(a.status)),
    );
    check(
      a.size === undefined || (Number.isInteger(a.size) && Number(a.size) >= 0),
    );
    check(
      a.text === undefined ||
        (typeof a.text === 'string' &&
          new TextEncoder().encode(a.text).length <= MAX_ATTACHMENT_TEXT),
    );
    check(
      /^(data:|https?:\/\/)/i.test(String(a.url)) ||
        (a.url === '' && ['missing', 'failed'].includes(String(a.status))),
    );
    if (String(a.url).startsWith('data:')) dataUrlBytes(String(a.url));
    if (a.status === 'stored') check(String(a.url).startsWith('data:'));
  }
}
function draft(key: string, value: unknown) {
  if (key.startsWith('model-probes-')) {
    check(Array.isArray(value));
    for (const probe of value)
      check(
        object(probe) &&
          ['field', 'status', 'detail'].every(
            (field) => typeof probe[field] === 'string',
          ),
      );
    return;
  }
  check(object(value));
  fields(
    value,
    [
      'title',
      'body',
      'editor',
      'source',
      'name',
      'platform',
      'ttl',
      'workspaceName',
      'query',
      'scope',
      'kind',
      'limit',
      'tab',
      'link',
      'protocol',
      'json',
      'text',
      'format',
      'summaryId',
      'instruction',
      'provider',
      'baseUrl',
      'model',
      'system',
      'thinking',
      'outputField',
    ],
    'string',
  );
  fields(
    value,
    ['star', 'connected', 'configured', 'modelEnabled', 'auto', 'review'],
    'boolean',
  );
  for (const field of ['from', 'to', 'batch', 'budget', 'maxOutput'])
    check(value[field] === undefined || Number.isFinite(value[field]));
  if (value.messages !== undefined) {
    check(Array.isArray(value.messages));
    check(
      value.messages.every(
        (message) =>
          object(message) &&
          typeof message.role === 'string' &&
          typeof message.content === 'string',
      ),
    );
  }
  if (value.attachments !== undefined) attachments(value.attachments);
  if (value.promptBlocks !== undefined) blocks(value.promptBlocks);
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
    check(
      entry.key === HUB_KEY ||
        entry.key === 'delivery-connection-v1' ||
        entry.key === 'search-draft' ||
        /^(turn-draft-|note-draft-|new-note-|model-draft-|model-probes-|workbench-|connection-draft-|import-draft|new-workspace-draft)/.test(
          entry.key,
        ),
    );
    check(object(entry.value) || Array.isArray(entry.value));
    if (entry.key !== HUB_KEY) draft(entry.key, entry.value);
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
    unique(w.summaries);
    unique(w.blocks);
    check(Number.isInteger(w.retain) && w.retain >= 1);
    check(w.activeId === null || w.summaries.some((s) => s.id === w.activeId));
    check(w.watermark === null || w.turns.some((t) => t.id === w.watermark));
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
    draft('model-draft', w.config);
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
