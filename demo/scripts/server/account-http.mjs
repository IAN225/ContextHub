import { AccountError } from './accounts.mjs';
export const accountCookie = (local) =>
  local ? 'ch_account_local' : '__Host-ch_account';
export function accountToken(req, local) {
  return req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(accountCookie(local) + '='))
    ?.split('=')[1];
}
export function setAccountCookie(res, token, local) {
  res.setHeader(
    'Set-Cookie',
    accountCookie(local) +
      '=' +
      token +
      '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
      (token ? '43200' : '0') +
      (local ? '' : '; Secure'),
  );
}
export function accountReply(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function json(req, limit = 8192) {
  if (!req.headers['content-type']?.includes('application/json'))
    throw new AccountError('请使用 JSON。', 415);
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw new AccountError('请求内容超过大小上限。', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AccountError('JSON 格式无效。');
  }
}
export function createAccountHttp(accounts) {
  const attempts = new Map();
  let deriving = 0;
  return async (req, res, { url, origin, local, user, token }) => {
    if (!url.pathname.startsWith('/api/account/')) return false;
    try {
      const action = url.pathname.slice('/api/account/'.length);
      if (action === 'status' && req.method === 'GET') {
        accountReply(res, 200, { mode: 'cloud', user });
        return true;
      }
      if (
        req.headers['x-context-hub'] !== '1' ||
        (req.method !== 'GET' && req.headers.origin !== origin)
      )
        throw new AccountError('请从当前页面操作。', 403);
      if (action === 'login' && req.method === 'POST') {
        const input = await json(req);
        const name = String(input.username ?? '')
          .toLowerCase()
          .slice(0, 100);
        const now = Date.now();
        for (const [key, value] of attempts)
          if (value.until < now) attempts.delete(key);
        const budget = attempts.get(name) ?? { count: 0, until: now + 600000 };
        if (deriving >= 4 || attempts.size >= 2000 || ++budget.count > 10)
          throw new AccountError('尝试过多，请稍后再试。', 429);
        attempts.set(name, budget);
        deriving++;
        let result;
        try {
          result = await accounts.login(input.username, input.password);
        } finally {
          deriving--;
        }
        if (!result) throw new AccountError('用户名或密码不正确。', 401);
        attempts.delete(name);
        if (token) accounts.logout(token);
        setAccountCookie(res, result.token, local);
        accountReply(res, 200, { user: result.user });
        return true;
      }
      if (!user) throw new AccountError('请先登录。', 401);
      if (req.headers['x-context-hub-user'] !== user.id)
        throw new AccountError('登录账号已变化，请刷新页面。', 409);
      if (action === 'logout' && req.method === 'POST') {
        accounts.logout(token);
        setAccountCookie(res, '', local);
        accountReply(res, 200, { ok: true });
        return true;
      }
      if (action === 'password' && req.method === 'POST') {
        const input = await json(req);
        if (deriving >= 4)
          throw new AccountError('服务繁忙，请稍后重试。', 429);
        deriving++;
        try {
          await accounts.password(
            user.id,
            input.currentPassword,
            input.password,
          );
        } finally {
          deriving--;
        }
        setAccountCookie(res, '', local);
        accountReply(res, 200, { ok: true });
        return true;
      }
      if (action === 'data' && req.method === 'GET') {
        const key = url.searchParams.get('key');
        accountReply(
          res,
          200,
          key === null
            ? accounts.entries(user.id)
            : accounts.read(user.id, key),
        );
        return true;
      }
      if (action === 'data' && req.method === 'POST') {
        const input = await json(req, 64 * 1024 * 1024);
        accountReply(res, 200, accounts.write(user.id, input));
        return true;
      }
      throw new AccountError('接口不存在。', 404);
    } catch (error) {
      accountReply(res, error instanceof AccountError ? error.status : 500, {
        error:
          error instanceof AccountError
            ? error.message
            : '账号操作未完成，请稍后重试。',
      });
      return true;
    }
  };
}
