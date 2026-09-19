import {
  decodeAuxiliary,
  encodeAuxiliary,
} from '../../lib/storage/auxiliary.ts';
import { createEmptyHubState } from '../../lib/state/empty.ts';
import { normalizeHubState } from '../../lib/state/validation.ts';
import {
  HUB_KEY,
  RECORD_PREFIX,
  decodeRecord,
  joinHub,
} from '../../lib/storage/records.ts';
import { AccountError, hash } from './account-credentials.mjs';
export function accountRecords({ db, lifecycle, transaction }) {
  function storedValue(key, raw) {
    const value = JSON.parse(raw);
    return key.startsWith(RECORD_PREFIX) || key === HUB_KEY
      ? value
      : decodeAuxiliary(key, value);
  }
  function record(id, key) {
    const row = db
      .prepare(
        'SELECT value_json,revision FROM account_records WHERE user_id=? AND record_key=?',
      )
      .get(id, key);
    return {
      key,
      revision: row?.revision ?? 0,
      ...(row?.value_json != null
        ? { value: storedValue(key, row.value_json) }
        : {}),
    };
  }
  return {
    read(id, key) {
      const user = lifecycle.requireActive(id);
      if (typeof key !== 'string' || key.length > 300)
        throw new AccountError('存储键无效。');
      return { generation: user.generation, entry: record(id, key) };
    },
    entries(id) {
      return transaction(() => {
        const user = lifecycle.requireActive(id);
        const entries = db
          .prepare(
            'SELECT record_key,value_json,revision FROM account_records WHERE user_id=? AND value_json IS NOT NULL ORDER BY record_key',
          )
          .all(id)
          .map((row) => ({
            key: row.record_key,
            value: storedValue(row.record_key, row.value_json),
            revision: row.revision,
          }));
        return { generation: user.generation, entries };
      });
    },
    write(id, input) {
      if (
        !input ||
        !Array.isArray(input.entries) ||
        input.entries.length > 100000 ||
        !Number.isSafeInteger(input.generation) ||
        !['write', 'replace'].includes(input.mode) ||
        typeof input.commitId !== 'string' ||
        !/^[a-zA-Z0-9_-]{16,100}$/.test(input.commitId)
      )
        throw new AccountError('存储请求无效。');
      const seen = new Set();
      for (const entry of input.entries) {
        if (
          !entry ||
          typeof entry.key !== 'string' ||
          !entry.key ||
          entry.key.length > 300 ||
          seen.has(entry.key) ||
          !Number.isSafeInteger(entry.revision) ||
          entry.revision < 0
        )
          throw new AccountError('存储条目无效。');
        if (input.mode === 'write' && entry.key.startsWith(RECORD_PREFIX))
          throw new AccountError('请使用工作区操作接口保存业务数据。', 426);
        if (entry.key === HUB_KEY)
          throw new AccountError('存储格式已升级，请刷新页面后再保存。', 426);
        if (entry.key.startsWith(RECORD_PREFIX) && entry.value !== undefined) {
          try {
            decodeRecord(entry.value);
          } catch {
            throw new AccountError('存储版本不兼容。', 426);
          }
        }
        if (!entry.key.startsWith(RECORD_PREFIX)) {
          try {
            if (entry.value !== undefined)
              encodeAuxiliary(entry.key, entry.value);
          } catch {
            throw new AccountError('偏好或草稿格式无效。');
          }
        }
        seen.add(entry.key);
      }
      const guards = input.guards ?? [];
      if (
        !Array.isArray(guards) ||
        guards.length > 100000 ||
        guards.some(
          (e) =>
            !e ||
            typeof e.key !== 'string' ||
            e.key.length > 300 ||
            !Number.isSafeInteger(e.revision) ||
            e.revision < 0,
        )
      )
        throw new AccountError('依赖记录版本无效。');
      const fingerprint = hash(JSON.stringify(input));
      return transaction(() => {
        const user = lifecycle.requireActive(id);
        const receipt = db
          .prepare(
            'SELECT body_hash,result_json FROM account_commits WHERE user_id=? AND commit_id=?',
          )
          .get(id, input.commitId);
        if (receipt) {
          if (receipt.body_hash !== fingerprint)
            throw new AccountError('保存编号冲突。', 409);
          return JSON.parse(receipt.result_json);
        }
        if (user.generation !== input.generation)
          throw new AccountError(
            '账号数据已在其他页面恢复，请刷新后继续。',
            409,
          );
        for (const entry of [...input.entries, ...guards]) {
          if (record(id, entry.key).revision !== entry.revision)
            throw new AccountError(
              '数据已在另一页面或设备更新。请先复制未保存内容，再刷新页面。',
              409,
            );
        }
        let generation = user.generation;
        if (input.mode === 'replace') {
          // A restore must compare every existing record, including keys absent from the backup.
          const expected = input.expected;
          const rows = db
            .prepare(
              'SELECT record_key,revision FROM account_records WHERE user_id=? AND value_json IS NOT NULL',
            )
            .all(id);
          if (
            !Array.isArray(expected) ||
            rows.length !== expected.length ||
            rows.some(
              (row) =>
                !expected.some(
                  (e) =>
                    e.key === row.record_key && e.revision === row.revision,
                ),
            )
          )
            throw new AccountError('云端数据已变化，请重新预览恢复。', 409);
          const restored = normalizeHubState(
            joinHub(input.entries) ?? createEmptyHubState(),
          );
          if (restored.workspaces.some((w) => w.summaryEngine !== undefined))
            throw new AccountError('备份包含无效的摘要投影。');
          db.prepare(
            "UPDATE background_tasks SET status='cancelled',lease=NULL,lease_until=NULL,acknowledged=step WHERE owner_id=?",
          ).run(id);
          db.prepare(
            'UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=?',
          ).run(Date.now(), id);
          db.prepare('UPDATE import_owners SET key_hash=NULL WHERE id=?').run(
            id,
          );
          db.prepare(
            'UPDATE mcp_oauth_requests SET denied=1,consumed=1 WHERE owner_id=?',
          ).run(id);
          db.prepare('DELETE FROM mcp_workspaces WHERE owner_id=?').run(id);
          db.prepare('DELETE FROM account_records WHERE user_id=?').run(id);
          generation++;
          db.prepare('UPDATE users SET generation=? WHERE id=?').run(
            generation,
            id,
          );
        }
        const upsert = db.prepare(
          'INSERT INTO account_records(user_id,record_key,value_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,record_key) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision,updated_at=excluded.updated_at',
        );
        const entries = input.entries.map((entry) => {
          const json =
            entry.value === undefined
              ? null
              : JSON.stringify(
                  entry.key.startsWith(RECORD_PREFIX)
                    ? entry.value
                    : encodeAuxiliary(entry.key, entry.value),
                );
          const current = db
            .prepare(
              'SELECT value_json,revision FROM account_records WHERE user_id=? AND record_key=?',
            )
            .get(id, entry.key);
          const revision =
            current && current.value_json === json
              ? Number(current.revision)
              : entry.revision + 1;
          if (!current || current.value_json !== json)
            upsert.run(id, entry.key, json, revision, Date.now());
          return { key: entry.key, revision };
        });
        const total = db
          .prepare(
            'SELECT COALESCE(SUM(length(CAST(value_json AS BLOB))),0) AS bytes FROM account_records WHERE user_id=?',
          )
          .get(id).bytes;
        if (total > 512 * 1024 * 1024)
          throw new AccountError(
            '账号存储超过 512 MB，请清理附件或回收站。',
            413,
          );
        const result = { generation, entries };
        db.prepare(
          'INSERT INTO account_commits(user_id,commit_id,body_hash,result_json,created_at) VALUES(?,?,?,?,?)',
        ).run(
          id,
          input.commitId,
          fingerprint,
          JSON.stringify(result),
          Date.now(),
        );
        db.prepare(
          'DELETE FROM account_commits WHERE user_id=? AND created_at<?',
        ).run(id, Date.now() - 7 * 86400000);
        return result;
      });
    },
  };
}
