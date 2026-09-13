import { createServer } from 'node:http';

// Explicitly bounded gateway: the application, management APIs, model settings,
// task runner, file storage and general proxying are never forwarded.
export function createMcpGateway({
  origin,
  key,
  target = 'http://127.0.0.1:3000',
}) {
  const publicUrl = new URL(origin);
  if (
    publicUrl.protocol !== 'https:' ||
    publicUrl.origin !== origin ||
    !/^[a-f0-9]{64}$/.test(key)
  )
    throw new Error('Invalid gateway config');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(target))
    throw new Error('Invalid loopback target');
  let inFlight = 0;
  const budgets = new Map();
  return createServer(async (req, res) => {
    const reply = (status, body = '') => {
      res.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      res.end(body);
    };
    const path = req.url?.split('?')[0] ?? '';
    const allowed =
      /^\/mcp\/[a-zA-Z0-9_-]{1,200}$/.test(path) ||
      /^\/oauth\/(authorize|complete|register|token|revoke)$/.test(path) ||
      path === '/.well-known/oauth-authorization-server' ||
      /^\/\.well-known\/oauth-protected-resource\/mcp\/[a-zA-Z0-9_-]{1,200}$/.test(
        path,
      );
    if (
      !allowed ||
      !['GET', 'POST', 'DELETE', 'OPTIONS'].includes(req.method) ||
      req.url.length > 8192
    ) {
      req.resume();
      return reply(404);
    }
    if (
      req.headers.host !== publicUrl.host &&
      ![
        `127.0.0.1:${req.socket.localPort}`,
        `localhost:${req.socket.localPort}`,
      ].includes(req.headers.host)
    ) {
      req.resume();
      return reply(403);
    }
    if (req.headers.origin && req.headers.origin !== origin) {
      req.resume();
      return reply(403);
    }
    const now = Date.now();
    for (const [ip, b] of budgets) if (b.until < now) budgets.delete(ip);
    const ip = String(
      req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress,
    );
    const budget = budgets.get(ip) ?? { count: 0, until: now + 60000 };
    if (
      (budgets.size >= 2000 && !budgets.has(ip)) ||
      ++budget.count > 120 ||
      inFlight >= 32
    ) {
      req.resume();
      return reply(429);
    }
    budgets.set(ip, budget);
    inFlight++;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      if (!req.complete) req.destroy();
    }, 30000);
    req.on('aborted', () => controller.abort());
    res.on('close', () => controller.abort());
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 1048576) {
          req.resume();
          return reply(413);
        }
        chunks.push(chunk);
      }
      const headers = { 'x-context-hub-gateway-key': key };
      for (const name of [
        'authorization',
        'content-type',
        'accept',
        'mcp-protocol-version',
        'origin',
      ])
        if (typeof req.headers[name] === 'string')
          headers[name] = req.headers[name];
      if (path.startsWith('/oauth/')) {
        const cookie = req.headers.cookie
          ?.split(';')
          .map((c) => c.trim())
          .find((c) => /^ch_oauth_browser=[a-f0-9]{64}$/.test(c));
        if (cookie) headers.cookie = cookie;
      }
      const result = await fetch(target + req.url, {
        method: req.method,
        headers,
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      const out = {};
      for (const name of [
        'content-type',
        'cache-control',
        'pragma',
        'www-authenticate',
        'allow',
        'location',
        'set-cookie',
        'content-security-policy',
        'referrer-policy',
        'x-content-type-options',
      ]) {
        const value = result.headers.get(name);
        if (value) out[name] = value;
      }
      res.writeHead(result.status, out);
      if (result.body) for await (const chunk of result.body) res.write(chunk);
      res.end();
    } catch {
      if (!res.headersSent) reply(502, '本机 MCP 服务暂不可用。');
      else res.end();
    } finally {
      clearTimeout(timer);
      inFlight--;
    }
  });
}
