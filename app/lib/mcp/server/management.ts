import { uid } from '../../core/identity.ts';
import { discardRequestBody } from '../../server/body.ts';
import { digest, randomSecret } from '../../server/crypto.ts';
import {
  MAX_MCP_BYTES,
  McpError,
  object,
  publicToken,
  type McpToken,
} from '../contracts.ts';
import { oauthClientName } from '../oauth-clients.ts';
import {
  errorInfo,
  headers,
  json,
  localOrigin,
  requireManagementRequest,
  workspace,
} from './http.ts';
import type { OAuthRepository } from './oauth-repository.ts';
import { OAUTH_SCOPE } from './oauth.ts';
import type { McpRepository } from './repository.ts';
export async function manageMcp(
  request: Request,
  action: string,
  repo: McpRepository,
  oauth?: { repo: OAuthRepository; origin: string | null },
  accountId?: string,
) {
  try {
    localOrigin(request);
    requireManagementRequest(request);
    if (!accountId) throw new McpError('UNAUTHORIZED', '请先登录。', 401);
    const ownerId = await repo.accountSession(accountId);
    if (action === 'reset' && request.method === 'POST') {
      if (ownerId && oauth) await oauth.repo.reset(ownerId);
      if (ownerId) await repo.reset(ownerId);
      return Response.json({ reset: true }, { headers });
    }
    if (action === 'remove-workspace' && request.method === 'POST') {
      const body = object(await json(request, 4096));
      if (
        typeof body.workspaceId !== 'string' ||
        !body.workspaceId ||
        body.workspaceId.length > 200
      )
        throw new McpError('INVALID_WORKSPACE', '工作区 ID 无效。');
      if (ownerId) await repo.removeWorkspace(ownerId, body.workspaceId);
      return Response.json({ removed: true }, { headers });
    }
    if (action === 'status' && request.method === 'GET') {
      const state = ownerId
        ? await repo.list(ownerId)
        : { workspaces: [], tokens: [] };
      return Response.json(
        {
          connected: !!ownerId,
          publicOrigin: oauth?.origin ?? null,
          workspaces: state.workspaces,
          tokens: state.tokens.map(publicToken),
        },
        { headers },
      );
    }
    if (accountId && !oauth?.origin)
      throw new McpError('HTTPS_REQUIRED', '配置 HTTPS 后可启用 MCP。', 403);
    if (action === 'oauth' && request.method === 'POST') {
      if (!oauth?.origin || !ownerId)
        throw new McpError('UNAUTHORIZED', '请先准备 OAuth 连接。', 401);
      const body = object(await json(request, 4096));
      const r = await oauth.repo.request(String(body.requestId));
      const wid = String(body.workspaceId);
      if (
        !r ||
        r.workspace_id !== wid ||
        r.resource !== `${oauth.origin}/mcp/${wid}` ||
        !(await repo.read(ownerId, wid))
      )
        throw new McpError('NOT_FOUND', '请求已到期或不属于此工作区。', 404);
      if (body.action === 'approve' || body.action === 'deny')
        await oauth.repo.approve(r.id, ownerId, wid, body.action === 'deny');
      else if (body.action !== 'inspect')
        throw new McpError('INVALID_ARGUMENTS', '未知授权操作。');
      return Response.json(
        {
          workspaceId: wid,
          redirectUri: r.redirect_uri,
          clientName: oauthClientName(r.redirect_uri),
          resource: r.resource,
          scope: OAUTH_SCOPE,
          expiresAt: r.expires_at,
          approved: body.action === 'approve',
        },
        { headers },
      );
    }
    if (['token', 'prepare'].includes(action) && request.method === 'POST') {
      const body = object(await json(request, MAX_MCP_BYTES));
      if (action === 'prepare') {
        if (!oauth?.origin)
          throw new McpError(
            'UNAVAILABLE',
            '请先启动 MCP HTTPS 联调入口。',
            503,
          );
        body.action = 'create';
        body.name = 'MCP OAuth';
        body.ttl = 2592000;
      }
      if (body.action === 'revoke') {
        if (!ownerId)
          throw new McpError('UNAUTHORIZED', '请先从连接页创建连接。', 401);
        await repo.revoke(
          ownerId,
          String(body.workspaceId),
          String(body.tokenId),
        );
        return Response.json({ revoked: true }, { headers });
      }
      if (!['create', 'rotate'].includes(String(body.action)))
        throw new McpError('INVALID_ARGUMENTS', '未知连接操作。');
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 100 ||
        !Number.isInteger(body.ttl) ||
        Number(body.ttl) < 3600 ||
        Number(body.ttl) > 2592000
      )
        throw new McpError(
          'INVALID_ARGUMENTS',
          '请填写连接名称，并选择 1 小时至 30 天的有效期。',
        );
      const w = {
        id:
          typeof body.workspaceId === 'string'
            ? body.workspaceId
            : workspace(body.workspace).id,
      };
      const existing = await repo.read(ownerId, w.id);
      if (!existing)
        throw new McpError('NOT_FOUND', '账号中没有此工作区。', 404);
      await repo.register(ownerId, w.id);
      if (action === 'prepare')
        return Response.json(
          { endpoint: `${oauth!.origin}/mcp/${encodeURIComponent(w.id)}` },
          {
            headers,
          },
        );
      const secret = randomSecret('ch_mcp_');
      const token: McpToken = {
        id: uid(),
        owner_id: ownerId,
        workspace_id: w.id,
        name: body.name.trim(),
        secret_hash: await digest(secret),
        created_at: Date.now(),
        expires_at: Date.now() + Number(body.ttl) * 1000,
        revoked_at: null,
      };
      await repo.createToken(
        token,
        body.action === 'rotate' ? String(body.tokenId) : undefined,
      );
      return Response.json(
        { token: publicToken(token), secret },
        {
          headers,
        },
      );
    }
    if (!ownerId)
      throw new McpError(
        'UNAUTHORIZED',
        '连接会话已失效，请在连接页重新创建连接。',
        401,
      );
    if (action === 'sync' && request.method === 'GET') {
      const snapshot = await repo.read(
        ownerId,
        new URL(request.url).searchParams.get('workspaceId') ?? '',
      );
      if (!snapshot)
        throw new McpError('NOT_FOUND', '没有此工作区的授权副本。', 404);
      return Response.json(
        {
          revision: snapshot.revision,
          events: snapshot.events,
          syncedAt: snapshot.syncedAt,
        },
        { headers },
      );
    }
    if (action === 'sync' && request.method === 'POST')
      throw new McpError('UPGRADE_REQUIRED', '服务已升级，请刷新页面。', 426);
    throw new McpError('NOT_FOUND', '接口不存在。', 404);
  } catch (error) {
    await discardRequestBody(request);
    const e = errorInfo(error);
    return Response.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status, headers },
    );
  }
}
