import type { WorkspaceApplication } from '../../application/server/workspaces.ts';
import { uid } from '../../core/identity.ts';
import type { SqlDatabase } from '../../server/database.ts';
import type { HubCommand } from '../../state/contracts.ts';
import { McpError, type McpToken, type MirrorSnapshot } from '../contracts.ts';
import { mcpWorkspace } from '../snapshot.ts';

export type Receipt = { request_hash: string; result_json: string };
export function mcpRepository(
  db: SqlDatabase,
  application: WorkspaceApplication,
) {
  const applicationSql = () => application.database;
  const sql = (query: string, ...args: unknown[]) =>
    db.prepare(query).bind(...args);
  async function findToken(hash: string) {
    const token = await sql(
      'SELECT * FROM mcp_tokens WHERE secret_hash=? AND revoked_at IS NULL AND expires_at>?',
      hash,
      Date.now(),
    ).first<McpToken>();
    if (token) {
      try {
        application.requireOwner(token.owner_id);
      } catch {
        return null;
      }
    }
    return token;
  }
  return {
    async register(owner: string, wid: string) {
      const current = application.read(owner);
      if (!current.state.workspaces.some((w) => w.id === wid))
        throw new McpError('NOT_FOUND', '工作区已不存在。', 404);
      await sql(
        'INSERT INTO mcp_workspaces(owner_id,workspace_id,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,workspace_id) DO UPDATE SET updated_at=excluded.updated_at',
        owner,
        wid,
        'account',
        Date.now(),
      ).run();
    },
    async accountSession(id: string) {
      application.requireOwner(id);
      await sql(
        'INSERT INTO mcp_sessions(id,session_hash,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING',
        id,
        'account:' + id,
        Date.now(),
      ).run();
      return id;
    },
    async list(owner: string) {
      application.requireOwner(owner);
      const [workspaces, tokens] = await Promise.all([
        sql(
          'SELECT workspace_id,updated_at FROM mcp_workspaces WHERE owner_id=? ORDER BY updated_at DESC',
          owner,
        ).all<{ workspace_id: string; updated_at: number }>(),
        sql(
          'SELECT t.*,g.expires_at AS grant_expires_at FROM mcp_tokens t LEFT JOIN mcp_oauth_grants g ON g.token_id=t.id WHERE t.owner_id=? ORDER BY t.created_at DESC',
          owner,
        ).all<McpToken>(),
      ]);
      return { workspaces: workspaces.results, tokens: tokens.results };
    },
    token: findToken,
    async downloadToken(id: string) {
      const row = await sql(
        'SELECT secret_hash FROM mcp_tokens WHERE id=?',
        id,
      ).first<{ secret_hash: string }>();
      return row ? findToken(row.secret_hash) : null;
    },
    async createToken(token: McpToken, replaceId?: string) {
      if (replaceId) {
        const result = await db.batch([
          sql(
            'UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND owner_id=? AND workspace_id=? AND revoked_at IS NULL',
            token.created_at,
            replaceId,
            token.owner_id,
            token.workspace_id,
          ),
          sql(
            `INSERT INTO mcp_tokens(id,owner_id,workspace_id,name,secret_hash,created_at,expires_at,revoked_at)
            SELECT ?,?,?,?,?,?,?,NULL WHERE changes()=1 AND EXISTS(SELECT 1 FROM mcp_tokens WHERE id=? AND owner_id=? AND workspace_id=? AND revoked_at=?)`,
            token.id,
            token.owner_id,
            token.workspace_id,
            token.name,
            token.secret_hash,
            token.created_at,
            token.expires_at,
            replaceId,
            token.owner_id,
            token.workspace_id,
            token.created_at,
          ),
        ]);
        if (!result[0].meta.changes || !result[1].meta.changes)
          throw new McpError('TOKEN_NOT_FOUND', '连接已不存在或已吊销。', 409);
      } else {
        await sql(
          'INSERT INTO mcp_tokens(id,owner_id,workspace_id,name,secret_hash,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,NULL)',
          token.id,
          token.owner_id,
          token.workspace_id,
          token.name,
          token.secret_hash,
          token.created_at,
          token.expires_at,
        ).run();
      }
    },
    async revoke(owner: string, wid: string, id: string) {
      await sql(
        'UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner_id=? AND workspace_id=?',
        Date.now(),
        id,
        owner,
        wid,
      ).run();
    },
    async removeWorkspace(owner: string, wid: string) {
      await db.batch([
        sql(
          'UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE owner_id=? AND workspace_id=?',
          Date.now(),
          owner,
          wid,
        ),
        sql(
          'DELETE FROM mcp_receipts WHERE token_id IN (SELECT id FROM mcp_tokens WHERE owner_id=? AND workspace_id=?)',
          owner,
          wid,
        ),
        sql(
          'DELETE FROM mcp_chunks WHERE owner_id=? AND workspace_id=?',
          owner,
          wid,
        ),
        sql(
          'DELETE FROM mcp_workspaces WHERE owner_id=? AND workspace_id=?',
          owner,
          wid,
        ),
      ]);
    },
    async reset(owner: string) {
      await db.batch([
        sql(
          'DELETE FROM mcp_receipts WHERE token_id IN (SELECT id FROM mcp_tokens WHERE owner_id=?)',
          owner,
        ),
        sql('DELETE FROM mcp_tokens WHERE owner_id=?', owner),
        sql('DELETE FROM mcp_chunks WHERE owner_id=?', owner),
        sql('DELETE FROM mcp_workspaces WHERE owner_id=?', owner),
      ]);
    },
    async read(owner: string, wid: string): Promise<MirrorSnapshot | null> {
      const snapshot = application.read(owner);
      const workspace = snapshot.state.workspaces.find((w) => w.id === wid);
      if (!workspace) return null;
      return {
        workspace: mcpWorkspace(workspace),
        events: [],
        syncedAt: new Date().toISOString(),
        revision: application.workspaceRevision(snapshot, wid),
      };
    },
    receipt: (tokenId: string, requestId: string) =>
      sql(
        'SELECT request_hash,result_json FROM mcp_receipts WHERE token_id=? AND request_id=?',
        tokenId,
        requestId,
      ).first<Receipt>(),
    async commit(
      owner: string,
      wid: string,
      expected: string,
      commands: HubCommand[],
      write: {
        token: McpToken;
        requestId: string;
        hash: string;
        result: object;
      },
    ) {
      return application.transaction(() => {
        const before = application.read(owner);
        if (application.workspaceRevision(before, wid) !== expected)
          throw new McpError(
            'CONCURRENT_CHANGE',
            '工作区已变化，请使用同一 request_id 重试。',
            409,
          );
        // Token and receipt checks share the write transaction with account data.
        const token = applicationSql()
          .prepare(
            'SELECT id FROM mcp_tokens WHERE id=? AND owner_id=? AND workspace_id=? AND secret_hash=? AND revoked_at IS NULL AND expires_at>?',
          )
          .get(write.token.id, owner, wid, write.token.secret_hash, Date.now());
        if (!token) throw new McpError('UNAUTHORIZED', '授权已失效。', 401);
        if (
          Number(
            applicationSql()
              .prepare(
                'SELECT COUNT(*) AS n FROM mcp_receipts WHERE token_id=?',
              )
              .get(write.token.id)!.n,
          ) >= 10000
        )
          throw new McpError(
            'RECEIPT_LIMIT',
            '连接写入已达上限，请轮换连接。',
            507,
          );
        for (const command of commands) {
          application.apply(owner, application.read(owner), command);
          if (
            command.type === 'workspace' &&
            ['note/create', 'note/replace'].includes(command.command.type)
          ) {
            const snapshot = application.read(owner),
              w = snapshot.state.workspaces.find((w) => w.id === wid)!;
            const noteId =
              command.command.type === 'note/create'
                ? command.command.note.id
                : 'noteId' in command.command
                  ? command.command.noteId
                  : '';
            const note = w.notes.find((n) => n.id === noteId)!;
            application.persist(owner, snapshot, {
              ...snapshot.state,
              noteNotifications: [
                {
                  id: uid(),
                  workspaceId: wid,
                  workspaceName: w.name,
                  noteId,
                  title: note.title,
                  clientName: write.token.name,
                  createdAt: new Date().toISOString(),
                  read: false,
                },
                ...(snapshot.state.noteNotifications ?? []),
              ].slice(0, 1000),
            });
          }
        }
        applicationSql()
          .prepare(
            'INSERT INTO mcp_receipts(token_id,request_id,request_hash,result_json,created_at) VALUES(?,?,?,?,?)',
          )
          .run(
            write.token.id,
            write.requestId,
            write.hash,
            JSON.stringify(write.result),
            Date.now(),
          );
      });
    },
  };
}
export type McpRepository = ReturnType<typeof mcpRepository>;
