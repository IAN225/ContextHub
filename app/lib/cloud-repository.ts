import { randomId } from './browser-compat.ts';
import type { DataRepository, StorageEntry } from './repository.ts';
import { CLIENT_PROTOCOL } from './storage/protocol.ts';
import { RECORD_PREFIX } from './storage/records.ts';
type RecordEntry = StorageEntry & { revision: number };
type ReadResult = { generation: number; entry: RecordEntry };
type ListResult = { generation: number; entries: RecordEntry[] };
type WriteResult = {
  generation: number;
  entries: { key: string; revision: number }[];
};
class CloudRepositoryError extends Error {
  override name = 'CloudRepositoryError';
}
export function createCloudRepository(
  fetcher: typeof fetch = fetch,
): DataRepository {
  let queue: Promise<unknown> = Promise.resolve();
  let generation: number | undefined;
  let replaced = false;
  const revisions = new Map<string, number>();
  const pending = new Map<string, string>();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  }
  async function request<T>(path: string, body?: unknown): Promise<T> {
    if (replaced) throw new CloudRepositoryError('数据已恢复，请刷新页面。');
    const response = await fetcher('/api/account/data' + path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Context-Hub': '1',
        'X-Context-Hub-Version': CLIENT_PROTOCOL,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = (await response.json()) as T & { error?: string };
    if (!response.ok)
      throw new CloudRepositoryError(
        value.error ?? '云端保存失败，请稍后重试。',
      );
    return value;
  }
  function remember(next: number) {
    if (generation !== undefined && generation !== next)
      throw new CloudRepositoryError('云端数据已恢复，请刷新页面。');
    generation = next;
  }
  async function read(key: string) {
    const result = await request<ReadResult>('?key=' + encodeURIComponent(key));
    remember(result.generation);
    if (!revisions.has(key)) revisions.set(key, result.entry.revision);
    else if (revisions.get(key) !== result.entry.revision)
      throw new CloudRepositoryError('数据已在另一页面更新，请刷新后继续。');
    return result.entry.value;
  }
  async function entries() {
    const result = await request<ListResult>('');
    remember(result.generation);
    for (const entry of result.entries) {
      if (
        !entry.key.startsWith(RECORD_PREFIX) &&
        revisions.has(entry.key) &&
        revisions.get(entry.key) !== entry.revision
      )
        throw new CloudRepositoryError('数据已在另一页面更新，请刷新后继续。');
      revisions.set(entry.key, entry.revision);
    }
    return result.entries;
  }
  async function write(
    values: readonly StorageEntry[],
    mode = 'write',
    expected?: RecordEntry[],
    guards: readonly string[] = [],
  ) {
    for (const entry of values)
      if (!revisions.has(entry.key)) await read(entry.key);
    for (const key of guards) if (!revisions.has(key)) await read(key);
    if (generation === undefined) await entries();
    const data = {
      mode,
      generation,
      guards: guards.map((key) => ({ key, revision: revisions.get(key) ?? 0 })),
      entries: values.map((entry) => ({
        ...entry,
        revision: revisions.get(entry.key) ?? 0,
      })),
      ...(expected
        ? {
            expected: expected.map((e) => ({
              key: e.key,
              revision: e.revision,
            })),
          }
        : {}),
    };
    const fingerprint = JSON.stringify(data);
    const commitId = pending.get(fingerprint) ?? randomId();
    pending.set(fingerprint, commitId);
    const result = await request<WriteResult>('', { ...data, commitId });
    generation = result.generation;
    for (const entry of result.entries)
      revisions.set(entry.key, entry.revision);
    pending.delete(fingerprint);
  }
  return {
    commitEntry: (entry, action) =>
      serial(async () => {
        if (!revisions.has(entry.key)) await read(entry.key);
        return action(revisions.get(entry.key) ?? 0, (revision) =>
          revisions.set(entry.key, revision),
        );
      }),
    flush: async () => {
      await queue;
      if (pending.size)
        throw new CloudRepositoryError(
          '仍有未确认的云端修改。请先重试保存，或复制未保存内容后刷新。',
        );
    },
    read: (key) => serial(() => read(key)),
    write: (values, guards) =>
      serial(() => write(values, 'write', undefined, guards)),
    entries: () => serial(entries),
    replace: (transform) =>
      serial(async () => {
        const current = await entries();
        await write(transform(current), 'replace', current);
        replaced = true;
      }),
  };
}
