import { randomId } from '../browser-compat.ts';
import { createEmptyHubState } from '../state/empty.ts';
import type {
  AccountSnapshot,
  ApplicationCommand,
  CommandRequest,
} from './contracts.ts';
export function createApplicationSession(fetcher: typeof fetch = fetch) {
  let current: AccountSnapshot = {
    state: createEmptyHubState(),
    generation: 0,
    revisions: {},
  };
  let view = {
    data: current.state,
    ready: false,
    saved: false,
    busy: false,
    error: '',
  };
  const serverView = view,
    listeners = new Set<() => void>();
  let queue: Promise<unknown> = Promise.resolve(),
    pending: CommandRequest | undefined;
  let etag: string | null = null;
  let applied: ((revision: number) => void) | undefined;
  let refreshVersion = 0;
  const publish = (patch: Partial<typeof view>) => {
    view = { ...view, ...patch };
    listeners.forEach((fn) => fn());
  };
  async function request(
    input?: CommandRequest,
  ): Promise<
    AccountSnapshot & {
      receipt?: { count: number; companionRevision?: number };
    }
  > {
    const response = await fetcher('/api/workspaces', {
      method: input ? 'POST' : 'GET',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Context-Hub': '1',
        ...(!input && etag ? { 'If-None-Match': etag } : {}),
      },
      ...(input ? { body: JSON.stringify(input) } : {}),
    });
    if (response.status === 304) return current;
    if (!input && response.ok) etag = response.headers.get('etag');
    if (input) etag = null;
    const value = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(value.error ?? '工作区操作失败。');
    return value as AccountSnapshot & {
      receipt?: { count: number; companionRevision?: number };
    };
  }
  async function refresh() {
    if (view.busy || pending) return;
    const version = ++refreshVersion;
    try {
      const next = await request();
      if (version !== refreshVersion || view.busy || pending) return;
      if (view.ready && next.generation !== current.generation)
        throw new Error('账号数据已恢复，请刷新页面。');
      if (
        !view.ready ||
        JSON.stringify(next.revisions) !== JSON.stringify(current.revisions)
      ) {
        current = next;
        publish({ data: next.state });
      }
      publish({ ready: true, saved: true, error: '' });
    } catch (error) {
      if (version === refreshVersion)
        publish({
          error: error instanceof Error ? error.message : '读取失败。',
        });
    }
  }
  async function send(
    command: ApplicationCommand,
    companion?: CommandRequest['companion'],
    onApplied?: (revision: number) => void,
  ) {
    if (!view.ready || pending) return false;
    ++refreshVersion;
    const input = {
      id: randomId(),
      generation: current.generation,
      expected: current.revisions,
      command,
      ...(companion ? { companion } : {}),
    };
    pending = input;
    applied = onApplied;
    publish({ busy: true, saved: false, error: '' });
    try {
      const next = await request(input);
      current = next;
      if (next.receipt?.companionRevision !== undefined)
        applied?.(next.receipt.companionRevision);
      pending = undefined;
      applied = undefined;
      publish({ data: next.state, saved: true });
      return true;
    } catch (error) {
      publish({ error: error instanceof Error ? error.message : '保存失败。' });
      return false;
    } finally {
      publish({ busy: false });
    }
  }
  return {
    getSnapshot: () => view,
    getServerSnapshot: () => serverView,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    refresh,
    commit(
      command: ApplicationCommand,
      companion?: CommandRequest['companion'],
      onApplied?: (revision: number) => void,
    ) {
      const result = queue.then(() => send(command, companion, onApplied));
      queue = result.catch(() => {});
      return result;
    },
    async retry() {
      if (!pending) return refresh();
      if (view.busy) return;
      publish({ busy: true });
      try {
        const next = await request(pending);
        current = next;
        if (next.receipt?.companionRevision !== undefined)
          applied?.(next.receipt.companionRevision);
        pending = undefined;
        applied = undefined;
        publish({ data: next.state, saved: true, error: '' });
      } catch (error) {
        publish({
          error: error instanceof Error ? error.message : '保存失败。',
        });
      } finally {
        publish({ busy: false });
      }
    },
  };
}
