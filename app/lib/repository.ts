export type StorageEntry = { key: string; value: unknown };
export interface Repository {
  read(key: string): Promise<unknown>;
  write(entries: readonly StorageEntry[]): Promise<void>;
}
export interface DataRepository extends Repository {
  flush?(): Promise<void>;
  entries(): Promise<StorageEntry[]>;
  replace(
    transform: (current: StorageEntry[]) => StorageEntry[],
  ): Promise<void>;
}
let selected: Promise<DataRepository> | undefined;
async function repository(): Promise<DataRepository> {
  if (!selected)
    selected = (async () => {
      const { getAccountStatus } = await import('./account/client');
      const status = await getAccountStatus();
      if (!status.user) throw new Error('请先登录。');
      const { createCloudRepository } = await import('./cloud-repository');
      return createCloudRepository();
    })().catch((error) => {
      selected = undefined;
      throw error;
    });
  return selected;
}
// All durable consumers use this adapter; cloud mode never reads legacy browser data.
export const accountRepository: DataRepository = {
  flush: async () => {
    if (selected) await (await selected).flush?.();
  },
  read: async (key) => (await repository()).read(key),
  write: async (entries) => (await repository()).write(entries),
  entries: async () => (await repository()).entries(),
  replace: async (transform) => (await repository()).replace(transform),
};
