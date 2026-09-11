import { McpError } from '../contracts.ts';
import { oauthClientName } from '../oauth-clients.ts';

export type OAuthClient = {
  id: string;
  redirects: string;
  method: string;
  secret_hash: string | null;
};
export type OAuthRequest = {
  id: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  workspace_id: string;
  state: string;
  challenge: string;
  browser_hash: string;
  expires_at: number;
  owner_id: string | null;
  denied: number;
  code_hash: string | null;
  consumed: number;
};
export function oauthRepository(db: D1Database) {
  const sql = (q: string, ...args: unknown[]) => db.prepare(q).bind(...args);
  return {
    async cancel(id: string) {
      await sql(
        'UPDATE mcp_oauth_requests SET consumed=1,denied=1 WHERE id=? AND code_hash IS NULL AND consumed=0',
        id,
      ).run();
    },
    async reset(owner: string) {
      await db.batch([
        sql('DELETE FROM mcp_oauth_requests WHERE owner_id=?', owner),
        sql(
          'DELETE FROM mcp_oauth_refresh_history WHERE token_id IN (SELECT id FROM mcp_tokens WHERE owner_id=?)',
          owner,
        ),
        sql(
          'DELETE FROM mcp_oauth_grants WHERE token_id IN (SELECT id FROM mcp_tokens WHERE owner_id=?)',
          owner,
        ),
      ]);
    },
    async cleanup() {
      await sql(
        'DELETE FROM mcp_oauth_requests WHERE expires_at<?',
        Date.now(),
      ).run();
    },
    client: (id: string) =>
      sql(
        'SELECT * FROM mcp_oauth_clients WHERE id=?',
        id,
      ).first<OAuthClient>(),
    async register(client: OAuthClient) {
      const result = await sql(
        `INSERT INTO mcp_oauth_clients(id,redirects,method,secret_hash,created_at)
        SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM mcp_oauth_clients)<1000`,
        client.id,
        client.redirects,
        client.method,
        client.secret_hash,
        Date.now(),
      ).run();
      if (!result.meta.changes)
        throw new McpError(
          'temporarily_unavailable',
          '客户端登记已达上限。',
          503,
        );
    },
    async begin(r: OAuthRequest) {
      await this.cleanup();
      const result = await sql(
        `INSERT INTO mcp_oauth_requests(id,client_id,redirect_uri,resource,workspace_id,state,challenge,browser_hash,expires_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM mcp_oauth_requests)<200`,
        r.id,
        r.client_id,
        r.redirect_uri,
        r.resource,
        r.workspace_id,
        r.state,
        r.challenge,
        r.browser_hash,
        r.expires_at,
      ).run();
      if (!result.meta.changes)
        throw new McpError(
          'temporarily_unavailable',
          '授权请求较多，请稍后重试。',
          503,
        );
    },
    request: (id: string) =>
      sql(
        'SELECT * FROM mcp_oauth_requests WHERE id=? AND expires_at>?',
        id,
        Date.now(),
      ).first<OAuthRequest>(),
    async approve(id: string, owner: string, wid: string, deny: boolean) {
      const result = await sql(
        `UPDATE mcp_oauth_requests SET owner_id=?,denied=?
        WHERE id=? AND workspace_id=? AND expires_at>? AND owner_id IS NULL AND code_hash IS NULL AND consumed=0
        AND EXISTS(SELECT 1 FROM mcp_workspaces WHERE owner_id=? AND workspace_id=?)`,
        owner,
        deny ? 1 : 0,
        id,
        wid,
        Date.now(),
        owner,
        wid,
      ).run();
      if (!result.meta.changes)
        throw new McpError(
          'invalid_request',
          '请求已处理、已到期或不属于这本手账。',
          409,
        );
    },
    async code(id: string, hash: string) {
      const result = await sql(
        `UPDATE mcp_oauth_requests SET code_hash=?,expires_at=? WHERE id=?
        AND expires_at>? AND owner_id IS NOT NULL AND denied=0 AND code_hash IS NULL AND consumed=0`,
        hash,
        Date.now() + 60000,
        id,
        Date.now(),
      ).run();
      if (!result.meta.changes)
        throw new McpError(
          'invalid_request',
          '授权已完成或已到期，请重新连接。',
        );
    },
    codeRequest: (hash: string) =>
      sql(
        'SELECT * FROM mcp_oauth_requests WHERE code_hash=? AND expires_at>? AND consumed=0 AND denied=0',
        hash,
        Date.now(),
      ).first<OAuthRequest>(),
    async exchange(
      r: OAuthRequest,
      tokenId: string,
      accessHash: string,
      refreshHash: string,
    ) {
      const now = Date.now();
      const result = await db.batch([
        sql(
          `UPDATE mcp_oauth_requests SET consumed=1 WHERE id=? AND consumed=0 AND expires_at>? AND denied=0
          AND EXISTS(SELECT 1 FROM mcp_workspaces WHERE owner_id=? AND workspace_id=?)`,
          r.id,
          now,
          r.owner_id,
          r.workspace_id,
        ),
        sql(
          `INSERT INTO mcp_tokens(id,owner_id,workspace_id,name,secret_hash,created_at,expires_at,resource)
          SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`,
          tokenId,
          r.owner_id,
          r.workspace_id,
          `${oauthClientName(r.redirect_uri) ?? 'MCP 客户端'} · OAuth`,
          accessHash,
          now,
          now + 3600000,
          r.resource,
        ),
        sql(
          `INSERT INTO mcp_oauth_grants(token_id,client_id,resource,refresh_hash,expires_at)
          SELECT ?,?,?,?,? WHERE changes()=1`,
          tokenId,
          r.client_id,
          r.resource,
          refreshHash,
          now + 2592000000,
        ),
      ]);
      if (result.some((v) => !v.meta.changes))
        throw new McpError('invalid_grant', '授权码已使用或已到期。');
    },
    grant: (hash: string) =>
      sql(
        `SELECT g.*,t.revoked_at FROM mcp_oauth_grants g
      JOIN mcp_tokens t ON t.id=g.token_id WHERE g.refresh_hash=?`,
        hash,
      ).first<{
        token_id: string;
        client_id: string;
        resource: string;
        refresh_hash: string;
        expires_at: number;
        revoked_at: number | null;
      }>(),
    async replay(hash: string, client: string) {
      await sql(
        `UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id IN
        (SELECT h.token_id FROM mcp_oauth_refresh_history h JOIN mcp_oauth_grants g ON g.token_id=h.token_id WHERE h.hash=? AND g.client_id=?)`,
        Date.now(),
        hash,
        client,
      ).run();
    },
    async refresh(
      id: string,
      oldHash: string,
      newHash: string,
      accessHash: string,
    ) {
      const result = await db.batch([
        sql(
          `UPDATE mcp_oauth_grants SET refresh_hash=? WHERE token_id=? AND refresh_hash=? AND expires_at>?
          AND EXISTS(SELECT 1 FROM mcp_tokens WHERE id=? AND revoked_at IS NULL)
          AND (SELECT COUNT(*) FROM mcp_oauth_refresh_history WHERE token_id=?)<10000`,
          newHash,
          id,
          oldHash,
          Date.now(),
          id,
          id,
        ),
        sql(
          `UPDATE mcp_tokens SET secret_hash=?,expires_at=MIN(?,(SELECT expires_at FROM mcp_oauth_grants WHERE token_id=?)) WHERE id=? AND changes()=1`,
          accessHash,
          Date.now() + 3600000,
          id,
          id,
        ),
        sql(
          `INSERT INTO mcp_oauth_refresh_history(hash,token_id) SELECT ?,? WHERE changes()=1`,
          oldHash,
          id,
        ),
      ]);
      if (result.some((v) => !v.meta.changes))
        throw new McpError('invalid_grant', '续期凭据已变化或授权已失效。');
    },
    async revoke(hash: string, client: string) {
      await sql(
        `UPDATE mcp_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id IN
        (SELECT g.token_id FROM mcp_oauth_grants g JOIN mcp_tokens t ON t.id=g.token_id
          WHERE g.client_id=? AND (g.refresh_hash=? OR t.secret_hash=?))`,
        Date.now(),
        client,
        hash,
        hash,
      ).run();
    },
  };
}
export type OAuthRepository = ReturnType<typeof oauthRepository>;
