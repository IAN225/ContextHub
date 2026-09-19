import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { workspaceApplication } from '../../lib/application/server/workspaces.ts';
import { sqliteDatabase } from '../../lib/server/sqlite.ts';
import { createEmptyHubState } from '../../lib/state/empty.ts';
import { applyHubCommand } from '../../lib/state/hub-reducer.ts';
import { normalizeHubState } from '../../lib/state/validation.ts';
import { decodePayload } from '../../lib/storage/payload.ts';
import { joinHub, RECORD_PREFIX } from '../../lib/storage/records.ts';

const tables = [
  'import_owners',
  'import_deliveries',
  'task_sessions',
  'background_tasks',
  'task_chunks',
  'summary_settings',
  'account_summary_settings',
  'summary_engine_settings',
  'mcp_sessions',
  'mcp_workspaces',
  'mcp_chunks',
  'mcp_tokens',
  'mcp_receipts',
  'mcp_oauth_clients',
  'mcp_oauth_requests',
  'mcp_oauth_grants',
  'mcp_oauth_refresh_history',
];
function* findDatabases(path) {
  if (!existsSync(path)) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink())
      throw new Error('Legacy state contains a symlink');
    const item = join(path, entry.name);
    if (entry.isDirectory()) yield* findDatabases(item);
    else if (entry.name.endsWith('.sqlite')) yield item;
  }
}
export function migrateLegacyData(raw, directory) {
  if (
    raw
      .prepare("SELECT value FROM application_meta WHERE key='legacy-import'")
      .get()
  )
    return;
  const db = sqliteDatabase(raw),
    app = workspaceApplication(db);
  const sources = [];
  try {
    for (const path of findDatabases(join(dirname(directory), 'state'))) {
      const source = new DatabaseSync(path, { readOnly: true });
      if (
        !source
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='mcp_workspaces' AND type='table'",
          )
          .get()
      ) {
        source.close();
        continue;
      }
      source.exec('BEGIN');
      sources.push(source);
    }
    if (sources.length > 1)
      throw new Error(
        'Multiple legacy business databases found; migration needs an explicit source',
      );
    db.transaction(() => {
      for (const source of sources) {
        const known = new Set(
          source
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all()
            .map((row) => row.name),
        );
        for (const table of tables) {
          if (!known.has(table)) continue;
          const fields = source
            .prepare('PRAGMA table_info(' + table + ')')
            .all()
            .map((row) => row.name);
          const target = new Set(
            raw
              .prepare('PRAGMA table_info(' + table + ')')
              .all()
              .map((row) => row.name),
          );
          if (fields.some((field) => !target.has(field)))
            throw new Error('Unknown legacy columns in ' + table);
          const insert = raw.prepare(
            'INSERT INTO ' +
              table +
              '(' +
              fields.join(',') +
              ') VALUES(' +
              fields.map(() => '?').join(',') +
              ')',
          );
          for (const row of source.prepare('SELECT * FROM ' + table).all())
            insert.run(...fields.map((field) => row[field]));
        }
      }
      for (const user of raw.prepare('SELECT id,generation FROM users').all()) {
        const rows = raw
          .prepare(
            'SELECT record_key,value_json,revision FROM account_records WHERE user_id=? AND record_key LIKE ?',
          )
          .all(user.id, RECORD_PREFIX + '%');
        const before = {
          generation: Number(user.generation),
          revisions: Object.fromEntries(
            rows.map((row) => [row.record_key, Number(row.revision)]),
          ),
          state: normalizeHubState(
            joinHub(
              rows
                .filter((row) => row.value_json !== null)
                .map((row) => ({
                  key: row.record_key,
                  value: JSON.parse(row.value_json),
                })),
            ) ?? createEmptyHubState(),
          ),
        };
        let next = before.state;
        for (const mirror of raw
          .prepare('SELECT workspace_id FROM mcp_workspaces WHERE owner_id=?')
          .all(user.id)) {
          const chunks = raw
            .prepare(
              'SELECT body FROM mcp_chunks WHERE owner_id=? AND workspace_id=? ORDER BY part',
            )
            .all(user.id, mirror.workspace_id);
          if (!chunks.length) continue;
          const value = decodePayload(
            'mcp-mirror',
            JSON.parse(chunks.map((row) => row.body).join('')),
          );
          if (!next.workspaces.some((w) => w.id === mirror.workspace_id)) {
            raw
              .prepare(
                'INSERT INTO migration_candidates(owner_id,kind,payload) VALUES(?,?,?)',
              )
              .run(user.id, 'deleted-workspace-events', JSON.stringify(value));
            continue;
          }
          next = applyHubCommand(next, {
            type: 'mcp/receive',
            workspaceId: mirror.workspace_id,
            events: value.events,
          });
        }
        for (const delivery of raw
          .prepare(
            'SELECT upload_json FROM import_deliveries WHERE owner_id=? AND acknowledged_at IS NULL',
          )
          .all(user.id)) {
          if (delivery.upload_json)
            next = applyHubCommand(next, {
              type: 'upload/receive',
              uploads: [JSON.parse(delivery.upload_json)],
            });
        }
        for (const w of next.workspaces) {
          const key = 'new-note-' + w.id;
          const row = raw
            .prepare(
              'SELECT value_json FROM account_records WHERE user_id=? AND record_key=?',
            )
            .get(user.id, key);
          if (!row?.value_json) continue;
          const draft = JSON.parse(row.value_json);
          if (
            typeof draft.title !== 'string' ||
            typeof draft.body !== 'string' ||
            typeof draft.star !== 'boolean'
          )
            throw new Error('Invalid legacy note draft');
          if (draft.title || draft.body) {
            const at = new Date().toISOString(),
              id =
                'legacy-note-' +
                createHash('sha256')
                  .update(user.id + ':' + w.id)
                  .digest('hex')
                  .slice(0, 24);
            next = applyHubCommand(next, {
              type: 'workspace',
              workspaceId: w.id,
              command: {
                type: 'note/create',
                note: {
                  id,
                  title: draft.title,
                  body: draft.body,
                  star: draft.star,
                  status: 'normal',
                  createdAt: at,
                  updatedAt: at,
                  editor: '我',
                  source: '草稿恢复',
                  versions: [],
                },
              },
            });
          }
          raw
            .prepare(
              'UPDATE account_records SET value_json=NULL,revision=revision+1 WHERE user_id=? AND record_key=?',
            )
            .run(user.id, key);
        }
        app.persist(user.id, before, next);
        raw
          .prepare('UPDATE background_tasks SET generation=? WHERE owner_id=?')
          .run(user.generation, user.id);
        for (const [id, step] of Object.entries(next.taskReceipts ?? {}))
          raw
            .prepare(
              'UPDATE background_tasks SET acknowledged=MAX(acknowledged,MIN(step,?)) WHERE id=? AND owner_id=?',
            )
            .run(step, id, user.id);
        raw
          .prepare(
            'UPDATE import_deliveries SET upload_json=NULL,byte_length=0,acknowledged_at=COALESCE(acknowledged_at,?) WHERE owner_id=?',
          )
          .run(Date.now(), user.id);
      }
      // Unknown owners and removed workspaces are preserved, never attached to another account.
      raw.exec(
        "UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,1) WHERE owner_id NOT IN (SELECT id FROM users); UPDATE background_tasks SET status='cancelled',lease=NULL,lease_until=NULL WHERE owner_id NOT IN (SELECT id FROM users)",
      );
      raw.exec(
        "UPDATE background_tasks SET status='paused',lease=NULL,lease_until=NULL,error='升级前请求是否被模型处理无法确认，请检查后手动继续。' WHERE status IN ('running','pausing')",
      );
      raw
        .prepare(
          "INSERT INTO application_meta(key,value) VALUES('legacy-import',?)",
        )
        .run(
          JSON.stringify({
            version: 1,
            at: Date.now(),
            sources: sources.length,
          }),
        );
    });
  } finally {
    for (const source of sources) {
      source.exec('ROLLBACK');
      source.close();
    }
  }
}
