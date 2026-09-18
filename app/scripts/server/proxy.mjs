import { send } from './http.mjs';

import { request as httpRequest } from 'node:http';

export function proxy(
  req,
  res,
  port,
  { origin, management = false, secure = false, account, accountKey } = {},
) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  for (const key of Object.keys(headers)) {
    if (
      key.startsWith('x-context-hub-account') ||
      key === 'x-context-hub-user' ||
      key.startsWith('x-forwarded-') ||
      key.startsWith('cf-') ||
      key === 'forwarded' ||
      key === 'x-context-hub-gateway-key' ||
      key === 'x-context-hub-server'
    )
      delete headers[key];
  }
  if (account) {
    headers['x-context-hub-account'] = account.id;
    headers['x-context-hub-account-key'] = accountKey;
  }
  if (management) {
    if (headers.origin) headers.origin = `http://127.0.0.1:${port}`;
  } else if (origin) headers.host = new URL(origin).host;
  if (headers.cookie)
    headers.cookie = headers.cookie
      .split(';')
      .filter(
        (s) =>
          !/^\s*(?:ch_server_local|__Host-ch_server|ch_account_local|__Host-ch_account|context_hub_mcp|context_hub_tasks|context_hub_import_session)=/.test(
            s,
          ),
      )
      .join(';');
  const upstream = httpRequest(
    { host: '127.0.0.1', port, path: req.url, method: req.method, headers },
    (reply) => {
      const out = { ...reply.headers };
      if (secure && out['set-cookie'])
        out['set-cookie'] = out['set-cookie'].map((s) =>
          /;\s*Secure(?:;|$)/i.test(s) ? s : `${s}; Secure`,
        );
      res.writeHead(reply.statusCode, out);
      reply.pipe(res);
    },
  );
  upstream.setTimeout(120000, () => upstream.destroy());
  upstream.on('error', () => {
    if (!res.headersSent)
      send(res, 503, { error: '应用正在启动或更新，请稍后重试。' });
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}
