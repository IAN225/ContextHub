import { createHash } from 'node:crypto';
import { purgeTrash } from '../../recycle-bin.ts';
import type { SQLiteDatabase } from '../../server/sqlite.ts';
import type { HubState } from '../../state/contracts.ts';
import { createEmptyHubState } from '../../state/empty.ts';
import { applyHubCommand } from '../../state/hub-reducer.ts';
import { normalizeHubState } from '../../state/validation.ts';
import { joinHub, RECORD_PREFIX, splitHub } from '../../storage/records.ts';
import { removeWorkspaceData } from '../../workspaces/lifecycle.ts';
import type {
  AccountSnapshot,
  ApplicationCommand,
  CommandRequest,
} from '../contracts.ts';
import { commandDependencies, validateCommand } from './commands.ts';

export class ApplicationError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function workspaceApplication(db: SQLiteDatabase) {
  const sql = db.raw;
  function requireOwner(owner: string) {
    const user = sql
      .prepare(
        "SELECT generation FROM users WHERE id=? AND disabled=0 AND status='active'",
      )
      .get(owner);
    if (
      !user ||
      !sql
        .prepare('SELECT activated_at FROM instance_settings WHERE id=1')
        .get()?.activated_at
    )
      throw new ApplicationError(
        'UNAUTHORIZED',
        '账号不可用或服务尚未激活。',
        401,
      );
    return Number(user.generation);
  }
  function read(owner: string): AccountSnapshot {
    const generation = requireOwner(owner);
    const rows = sql
      .prepare(
        'SELECT record_key,value_json,revision FROM account_records WHERE user_id=? AND record_key LIKE ? ORDER BY record_key',
      )
      .all(owner, RECORD_PREFIX + '%');
    const entries = rows
      .filter((row) => row.value_json !== null)
      .map((row) => ({
        key: String(row.record_key),
        value: JSON.parse(String(row.value_json)),
      }));
    return {
      generation,
      revisions: Object.fromEntries(
        rows.map((row) => [String(row.record_key), Number(row.revision)]),
      ),
      state: normalizeHubState(joinHub(entries) ?? createEmptyHubState()),
    };
  }
  function revision(owner: string) {
    const generation = requireOwner(owner);
    return (
      '"' +
      hash([
        generation,
        sql
          .prepare(
            'SELECT record_key,revision FROM account_records WHERE user_id=? AND record_key LIKE ? ORDER BY record_key',
          )
          .all(owner, RECORD_PREFIX + '%'),
      ]) +
      '"'
    );
  }
  function persist(owner: string, before: AccountSnapshot, next: HubState) {
    const validated = normalizeHubState(next);
    if (validated.workspaces.some((w) => w.summaryEngine !== undefined))
      throw new ApplicationError(
        'INVALID_WORKSPACE',
        '摘要投影不能保存为工作区。',
        400,
      );
    const old = new Map(
      splitHub(before.state).map((e) => [e.key, JSON.stringify(e.value)]),
    );
    const entries = splitHub(validated);
    const keys = new Set(entries.map((e) => e.key));
    const upsert = sql.prepare(
      'INSERT INTO account_records(user_id,record_key,value_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,record_key) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision,updated_at=excluded.updated_at',
    );
    for (const entry of entries) {
      const json = JSON.stringify(entry.value);
      if (before.revisions[entry.key] && old.get(entry.key) === json) continue;
      upsert.run(
        owner,
        entry.key,
        json,
        (before.revisions[entry.key] ?? 0) + 1,
        Date.now(),
      );
    }
    for (const key of old.keys())
      if (!keys.has(key))
        upsert.run(
          owner,
          key,
          null,
          (before.revisions[key] ?? 0) + 1,
          Date.now(),
        );
    const size = Number(
      sql
        .prepare(
          'SELECT COALESCE(SUM(length(CAST(value_json AS BLOB))),0) AS n FROM account_records WHERE user_id=?',
        )
        .get(owner)!.n,
    );
    if (size > 512 * 1024 * 1024)
      throw new ApplicationError('STORAGE_LIMIT', '账号存储超过 512 MB。', 413);
  }
  function lifecycle(owner: string, before: HubState, after: HubState) {
    for (const workspace of before.workspaces)
      if (!after.workspaces.some((w) => w.id === workspace.id)) {
        sql
          .prepare(
            'DELETE FROM mcp_workspaces WHERE owner_id=? AND workspace_id=?',
          )
          .run(owner, workspace.id);
        sql
          .prepare(
            'UPDATE mcp_oauth_requests SET denied=1,consumed=1 WHERE owner_id=? AND workspace_id=?',
          )
          .run(owner, workspace.id);
        sql
          .prepare(
            'UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND workspace_id=?',
          )
          .run(Date.now(), owner, workspace.id);
        sql
          .prepare(
            "UPDATE background_tasks SET status='cancelled',lease=NULL,lease_until=NULL,acknowledged=step WHERE owner_id=? AND workspace_id=?",
          )
          .run(owner, workspace.id);
        for (const entry of removeWorkspaceData(before, workspace.id)
          .companions)
          sql
            .prepare(
              'UPDATE account_records SET value_json=NULL,revision=revision+1 WHERE user_id=? AND record_key=?',
            )
            .run(owner, entry.key);
      }
  }
  function apply(
    owner: string,
    before: AccountSnapshot,
    command: ApplicationCommand,
  ) {
    const result =
      command.type === 'trash/purge'
        ? purgeTrash(before.state, command.mode)
        : null;
    const next =
      result?.state ??
      applyHubCommand(
        before.state,
        command as Exclude<ApplicationCommand, { type: 'trash/purge' }>,
      );
    persist(owner, before, next);
    lifecycle(owner, before.state, next);
    for (const draft of result?.drafts ?? [])
      sql
        .prepare(
          'UPDATE account_records SET value_json=NULL,revision=revision+1 WHERE user_id=? AND record_key=?',
        )
        .run(owner, draft.key);
    return result?.count ?? 0;
  }
  function workspaceRevision(snapshot: AccountSnapshot, wid: string) {
    const key = RECORD_PREFIX + 'workspace/' + encodeURIComponent(wid);
    return hash([
      snapshot.generation,
      Object.entries(snapshot.revisions).filter(
        ([k]) => k === key || k.startsWith(key + '/'),
      ),
    ]);
  }
  function execute(owner: string, input: CommandRequest) {
    return db.transaction(() => {
      try {
        validateCommand(input);
      } catch (error) {
        throw new ApplicationError(
          'INVALID_COMMAND',
          error instanceof Error ? error.message : '操作无效。',
          400,
        );
      }
      const before = read(owner);
      if (
        !input ||
        !/^[a-zA-Z0-9_-]{16,100}$/.test(input.id) ||
        !input.command ||
        typeof input.command.type !== 'string' ||
        !input.expected ||
        !Number.isSafeInteger(input.generation)
      )
        throw new ApplicationError('INVALID_COMMAND', '操作格式无效。', 400);
      if (before.generation !== input.generation)
        throw new ApplicationError(
          'GENERATION_CHANGED',
          '账号数据已恢复，请刷新页面。',
        );
      const fingerprint = hash(input);
      const receipt = sql
        .prepare(
          'SELECT body_hash,result_json FROM application_receipts WHERE owner_id=? AND request_id=?',
        )
        .get(owner, input.id);
      if (receipt) {
        if (receipt.body_hash !== fingerprint)
          throw new ApplicationError(
            'IDEMPOTENCY_CONFLICT',
            '操作编号已用于不同内容。',
          );
        return {
          ...read(owner),
          receipt: JSON.parse(String(receipt.result_json)),
        };
      }
      const command = input.command;
      if (command.type.startsWith('task/') || command.type === 'mcp/receive')
        throw new ApplicationError(
          'FORBIDDEN',
          '此操作仅允许服务端执行。',
          403,
        );
      // Commands compare their workspace rather than unrelated account data.
      const wid =
        'workspaceId' in command
          ? command.workspaceId
          : command.type === 'workspace/create'
            ? command.workspace.id
            : null;
      const relevant = commandDependencies(command);
      const keys = new Set([
        ...Object.keys(before.revisions),
        ...Object.keys(input.expected),
      ]);
      for (const key of keys)
        if (
          relevant(key) &&
          (before.revisions[key] ?? 0) !== (input.expected[key] ?? 0)
        )
          throw new ApplicationError(
            'REVISION_CONFLICT',
            '内容已变化，草稿已保留，请刷新后重新提交。',
          );
      if (
        wid &&
        command.type !== 'workspace/create' &&
        !before.state.workspaces.some((w) => w.id === wid)
      )
        throw new ApplicationError('NOT_FOUND', '工作区已不存在。', 404);
      const companion = input.companion;
      if (companion) {
        const prefixes =
          command.type === 'workspace/create'
            ? ['new-workspace-draft']
            : wid
              ? [
                  'note-draft-' + wid + '-',
                  'turn-draft-' + wid + '-',
                  'model-draft-' + wid,
                ]
              : [];
        if (
          !prefixes.some((prefix) => companion.key.startsWith(prefix)) ||
          !Number.isSafeInteger(companion.revision) ||
          companion.revision < 0
        )
          throw new ApplicationError('INVALID_DRAFT', '草稿关联无效。', 400);
        const current = sql
          .prepare(
            'SELECT revision FROM account_records WHERE user_id=? AND record_key=?',
          )
          .get(owner, companion.key);
        if (Number(current?.revision ?? 0) !== companion.revision)
          throw new ApplicationError(
            'REVISION_CONFLICT',
            '草稿已在另一页面更新。',
          );
      }
      const count = apply(owner, before, command);
      if (companion)
        sql
          .prepare(
            'INSERT INTO account_records(user_id,record_key,value_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,record_key) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision,updated_at=excluded.updated_at',
          )
          .run(
            owner,
            companion.key,
            JSON.stringify(companion.value) ?? null,
            companion.revision + 1,
            Date.now(),
          );
      const result = {
        id: input.id,
        count,
        ...(companion ? { companionRevision: companion.revision + 1 } : {}),
      };
      sql
        .prepare(
          'INSERT INTO application_receipts(owner_id,request_id,body_hash,result_json,created_at) VALUES(?,?,?,?,?)',
        )
        .run(owner, input.id, fingerprint, JSON.stringify(result), Date.now());
      return { ...read(owner), receipt: result };
    });
  }
  return {
    revision,
    database: sql,
    read: (owner: string) => db.transaction(() => read(owner)),
    requireOwner,
    persist,
    apply,
    execute,
    workspaceRevision,
    transaction: db.transaction,
  };
}
export type WorkspaceApplication = ReturnType<typeof workspaceApplication>;
