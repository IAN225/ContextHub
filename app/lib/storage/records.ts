import type { StorageEntry } from '../repository.ts';
// Stable account-scoped keys. A format version belongs to each record, not the UI model.
export const HUB_KEY = 'hub-state-v1';
export const RECORD_PREFIX = 'hub.v2/';
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('存储记录格式无效。');
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('存储列表格式无效。');
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 160)
    throw new Error('存储 ID 无效。');
  return encodeURIComponent(value);
}
export function encodeRecord(kind: string, data: unknown) {
  return { format: 'contexthub-record', kind, version: 1, data };
}
export function decodeRecord(value: unknown, kind?: string): unknown {
  const record = object(value);
  if (
    record.format !== 'contexthub-record' ||
    record.version !== 1 ||
    (kind && record.kind !== kind)
  )
    throw new Error('存储版本不兼容，请使用匹配的应用版本。');
  return record.data;
}
export function splitHub(value: unknown): StorageEntry[] {
  if (value === undefined) return [];
  const root = object(value);
  if (root.schemaVersion !== 1) throw new Error('工作区版本不兼容，无法迁移。');
  const records: StorageEntry[] = [];
  const keys = new Set<string>();
  const put = (key: string, kind: string, data: unknown) => {
    key = RECORD_PREFIX + key;
    if (keys.has(key) || key.length > 300)
      throw new Error('存储 ID 重复或过长。');
    keys.add(key);
    records.push({ key, value: encodeRecord(kind, data) });
  };
  const list = (
    values: unknown,
    prefix: string,
    kind: string,
    transform: (v: ObjectValue, p: string) => unknown = (v) => v,
  ) =>
    array(values).map((value) => {
      const v = object(value);
      const key = prefix + '/' + id(v.id);
      put(key, kind, transform(v, key));
      return v.id;
    });
  const workspaces = list(root.workspaces, 'workspace', 'workspace', (w, p) => {
    const { turns, notes, summaries, blocks, tokens, reme, ...metadata } = w;
    if (reme !== undefined) {
      const { summaries: history, ...settings } = object(reme);
      put(p + '/reme-settings', 'reme-settings', settings);
      put(
        p + '/reme-summaries',
        'summary-index',
        list(history, p + '/reme-summary', 'summary'),
      );
      metadata.hasReme = true;
    }
    const settings: ObjectValue = {};
    for (const key of [
      'activeId',
      'watermark',
      'retain',
      'retainMode',
      'retainTokens',
      'config',
      'started',
      'firstComplete',
    ]) {
      if (key in metadata) {
        settings[key] = metadata[key];
        delete metadata[key];
      }
    }
    put(p + '/summary-settings', 'summary-settings', settings);
    put(p + '/blocks', 'memory-blocks', blocks);
    put(p + '/tokens', 'connections', tokens);
    put(
      p + '/turns',
      'turn-index',
      list(turns, p + '/turn', 'turn', (t, tp) => {
        const { attachments, ...body } = t;
        return attachments === undefined
          ? body
          : {
              ...body,
              attachments: list(attachments, tp + '/attachment', 'attachment'),
            };
      }),
    );
    put(
      p + '/notes',
      'note-index',
      list(notes, p + '/note', 'note', (n, np) => {
        const { versions, ...body } = n;
        if (versions !== undefined)
          put(np + '/history', 'note-history', versions);
        return {
          ...body,
          ...(versions === undefined ? {} : { versions: true }),
        };
      }),
    );
    put(
      p + '/summaries',
      'summary-index',
      list(summaries, p + '/summary', 'summary'),
    );
    return metadata;
  });
  const uploads = list(root.uploads, 'upload', 'upload');
  put('root', 'hub', { ...root, workspaces, uploads });
  return records;
}
export function joinHub(entries: readonly StorageEntry[]): unknown {
  const records = new Map(
    entries.filter((e) => e.value !== undefined).map((e) => [e.key, e.value]),
  );
  if (!records.has(RECORD_PREFIX + 'root')) {
    if ([...records.keys()].some((k) => k.startsWith(RECORD_PREFIX)))
      throw new Error('工作区根记录缺失。');
    return undefined;
  }
  const get = (key: string, kind: string) => {
    if (!records.has(RECORD_PREFIX + key))
      throw new Error('工作区关联记录缺失：' + key);
    return decodeRecord(records.get(RECORD_PREFIX + key), kind);
  };
  const list = (
    ids: unknown,
    prefix: string,
    kind: string,
    transform: (v: ObjectValue, p: string) => unknown = (v) => v,
  ) =>
    array(ids).map((value) => {
      const p = prefix + '/' + id(value);
      return transform(object(get(p, kind)), p);
    });
  const root = object(get('root', 'hub'));
  return {
    ...root,
    workspaces: list(root.workspaces, 'workspace', 'workspace', (w, p) => ({
      ...Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'hasReme')),
      ...(w.hasReme
        ? {
            reme: {
              ...object(get(p + '/reme-settings', 'reme-settings')),
              summaries: list(
                get(p + '/reme-summaries', 'summary-index'),
                p + '/reme-summary',
                'summary',
              ),
            },
          }
        : {}),
      ...object(get(p + '/summary-settings', 'summary-settings')),
      blocks: get(p + '/blocks', 'memory-blocks'),
      tokens: get(p + '/tokens', 'connections'),
      turns: list(
        get(p + '/turns', 'turn-index'),
        p + '/turn',
        'turn',
        (t, tp) => ({
          ...t,
          ...(t.attachments === undefined
            ? {}
            : {
                attachments: list(
                  t.attachments,
                  tp + '/attachment',
                  'attachment',
                ),
              }),
        }),
      ),
      notes: list(
        get(p + '/notes', 'note-index'),
        p + '/note',
        'note',
        (n, np) => ({
          ...n,
          ...(n.versions === undefined
            ? {}
            : { versions: get(np + '/history', 'note-history') }),
        }),
      ),
      summaries: list(
        get(p + '/summaries', 'summary-index'),
        p + '/summary',
        'summary',
      ),
    })),
    uploads: list(root.uploads, 'upload', 'upload'),
  };
}
export function logicalEntries(
  entries: readonly StorageEntry[],
): StorageEntry[] {
  const hub = joinHub(entries);
  return [
    ...entries.filter((e) => !e.key.startsWith(RECORD_PREFIX)),
    ...(hub === undefined ? [] : [{ key: HUB_KEY, value: hub }]),
  ];
}
export function physicalEntries(
  entries: readonly StorageEntry[],
): StorageEntry[] {
  return entries.flatMap((e) => {
    if (e.key.startsWith(RECORD_PREFIX))
      throw new Error('内部存储键不能直接导入。');
    return e.key === HUB_KEY ? splitHub(e.value) : [e];
  });
}
