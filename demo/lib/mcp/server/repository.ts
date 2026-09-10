import { uid } from '../../domain.ts';
import {
  MAX_MCP_BYTES,
  McpError,
  type Mirror,
  type MirrorSnapshot,
  type McpToken,
} from '../contracts.ts';

function chunks(value: Mirror) {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).length > MAX_MCP_BYTES)
    throw new McpError(
      'MEMORY_TOO_LARGE',
      '授权手账及待接收变更超过 16 MB，请接收变更或缩小手账。',
      413,
    );
  const parts: string[] = [];
  for (let start = 0; start < body.length;) {
    let end = Math.min(start + 100000, body.length);
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end--;
    parts.push(body.slice(start, end));
    start = end;
  }
  return parts;
}
export type Receipt = { request_hash: string; result_json: string };
export function mcpRepository(db: D1Database) {
  const sql = (query: string, ...args: unknown[]) =>
    db.prepare(query).bind(...args);
  const metadata = (owner: string, wid: string) =>
    sql(
      'SELECT revision FROM mcp_workspaces WHERE owner_id=? AND workspace_id=?',
      owner,
      wid,
    ).first<{ revision: string }>();
  return {
    async session(hash: string) {
      return (
        await sql(
          'SELECT id FROM mcp_sessions WHERE session_hash=?',
          hash,
        ).first<{ id: string }>()
      )?.id;
    },
    async createSession(hash: string) {
      const id = uid();
      await sql(
        'INSERT INTO mcp_sessions(id,session_hash,created_at) VALUES(?,?,?)',
        id,
        hash,
        Date.now(),
      ).run();
      return id;
    },
    async list(owner: string) {
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
    token: (hash: string) =>
      sql(
        'SELECT * FROM mcp_tokens WHERE secret_hash=? AND revoked_at IS NULL AND expires_at>?',
        hash,
        Date.now(),
      ).first<McpToken>(),
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
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await metadata(owner, wid);
        if (!before) return null;
        const rows = await sql(
          'SELECT body FROM mcp_chunks WHERE owner_id=? AND workspace_id=? ORDER BY part',
          owner,
          wid,
        ).all<{ body: string }>();
        const after = await metadata(owner, wid);
        if (before.revision !== after?.revision) continue;
        return {
          ...(JSON.parse(rows.results.map((r) => r.body).join('')) as Mirror),
          revision: before.revision,
        };
      }
      throw new McpError('CONCURRENT_CHANGE', '手账正在更新，请重试。', 409);
    },
    receipt: (tokenId: string, requestId: string) =>
      sql(
        'SELECT request_hash,result_json FROM mcp_receipts WHERE token_id=? AND request_id=?',
        tokenId,
        requestId,
      ).first<Receipt>(),
    async save(
      owner: string,
      wid: string,
      expected: string | null,
      value: Mirror,
      write?: {
        token: McpToken;
        requestId: string;
        hash: string;
        result: object;
      },
    ) {
      if (value.events.length > 200)
        throw new McpError(
          'PENDING_LIMIT',
          '待接收变更已达上限，请打开手账接收后重试。',
          507,
        );
      const parts = chunks(value);
      const revision = uid();
      const when = Date.now();
      const guard =
        'EXISTS(SELECT 1 FROM mcp_workspaces WHERE owner_id=? AND workspace_id=? AND revision=?)';
      const mutation =
        expected === null
          ? sql(
              'INSERT INTO mcp_workspaces(owner_id,workspace_id,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,workspace_id) DO NOTHING',
              owner,
              wid,
              revision,
              when,
            )
          : write
            ? sql(
                `UPDATE mcp_workspaces SET revision=?,updated_at=? WHERE owner_id=? AND workspace_id=? AND revision=?
              AND EXISTS(SELECT 1 FROM mcp_tokens WHERE id=? AND owner_id=? AND workspace_id=? AND secret_hash=? AND revoked_at IS NULL AND expires_at>?)
              AND (SELECT COUNT(*) FROM mcp_receipts WHERE token_id=?) < 10000`,
                revision,
                when,
                owner,
                wid,
                expected,
                write.token.id,
                owner,
                wid,
                write.token.secret_hash,
                when,
                write.token.id,
              )
            : sql(
                'UPDATE mcp_workspaces SET revision=?,updated_at=? WHERE owner_id=? AND workspace_id=? AND revision=?',
                revision,
                when,
                owner,
                wid,
                expected,
              );
      const result = await db.batch([
        mutation,
        sql(
          `DELETE FROM mcp_chunks WHERE owner_id=? AND workspace_id=? AND ${guard}`,
          owner,
          wid,
          owner,
          wid,
          revision,
        ),
        ...parts.map((part, index) =>
          sql(
            `INSERT INTO mcp_chunks(owner_id,workspace_id,part,body) SELECT ?,?,?,? WHERE ${guard}`,
            owner,
            wid,
            index,
            part,
            owner,
            wid,
            revision,
          ),
        ),
        ...(write
          ? [
              sql(
                `INSERT INTO mcp_receipts(token_id,request_id,request_hash,result_json,created_at) SELECT ?,?,?,?,? WHERE ${guard}`,
                write.token.id,
                write.requestId,
                write.hash,
                JSON.stringify(write.result),
                when,
                owner,
                wid,
                revision,
              ),
            ]
          : []),
      ]);
      if (!result[0].meta.changes)
        throw new McpError(
          'CONCURRENT_CHANGE',
          '手账或授权已变化，或连接写入达到上限；请检查连接后使用同一 request_id 重试。',
          409,
        );
      return revision;
    },
  };
}
export type McpRepository = ReturnType<typeof mcpRepository>;
