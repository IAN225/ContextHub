import type { DataRepository, StorageEntry } from '../repository.ts';
import {
  HUB_KEY,
  RECORD_PREFIX,
  splitHub,
  joinHub,
  logicalEntries,
  physicalEntries,
} from './records.ts';
// UI and personal backups retain their aggregate view. Writes compare only changed records.
export function createEntityRepository(store: DataRepository): DataRepository {
  let baseline: StorageEntry[] | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  }
  async function load() {
    return (baseline ??= await store.entries());
  }
  return {
    read: (key) =>
      serial(async () =>
        key === HUB_KEY
          ? structuredClone(joinHub(await load()))
          : store.read(key),
      ),
    write: (entries) =>
      serial(async () => {
        const hub = entries.find((e) => e.key === HUB_KEY);
        if (!hub) {
          await store.write(entries);
          return;
        }
        const before = (await load()).filter((e) =>
          e.key.startsWith(RECORD_PREFIX),
        );
        const after = splitHub(hub.value);
        const old = new Map(
          before.map((e) => [e.key, JSON.stringify(e.value)]),
        );
        const next = new Set(after.map((e) => e.key));
        const changes: StorageEntry[] = [
          ...after.filter((e) => old.get(e.key) !== JSON.stringify(e.value)),
          ...before
            .filter((e) => !next.has(e.key))
            .map((e) => ({ key: e.key, value: undefined })),
          ...entries.filter((e) => e.key !== HUB_KEY),
        ];
        // Summary checkpoints depend on their source records. Compare those revisions
        // without rewriting them, so an old task cannot commit over newly edited input.
        const summaryWorkspaces = new Set(
          changes.flatMap((e) => {
            const match =
              /^hub\.v2\/workspace\/([^/]+)\/(summary-settings|summaries|summary\/)/.exec(
                e.key,
              );
            return match ? [RECORD_PREFIX + 'workspace/' + match[1] + '/'] : [];
          }),
        );
        const guards = before
          .filter((e) =>
            [...summaryWorkspaces].some((prefix) => e.key.startsWith(prefix)),
          )
          .map((e) => e.key);
        if (changes.length) await store.write(changes, guards);
        baseline = structuredClone(after);
      }),
    entries: () => serial(async () => logicalEntries(await store.entries())),
    replace: (transform) =>
      serial(async () => {
        await store.replace((current) =>
          physicalEntries(transform(logicalEntries(current))),
        );
        baseline = undefined;
      }),
    flush: async () => {
      await queue;
      await store.flush?.();
    },
  };
}
