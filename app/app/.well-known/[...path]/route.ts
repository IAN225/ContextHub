import { env } from 'cloudflare:workers';
import {
  gatewayRequest,
  type PublicMcpConfig,
} from '@/lib/mcp/server/public-config';
import { oauthMetadata } from '@/lib/mcp/server/oauth';
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const publicRequest = gatewayRequest(request, env as PublicMcpConfig);
    const path = (await context.params).path.join('/');
    const origin = new URL(publicRequest.url).origin;
    if (path === 'oauth-authorization-server') return oauthMetadata(origin);
    const match = path.match(
      /^oauth-protected-resource\/mcp\/([a-zA-Z0-9_-]{1,200})$/,
    );
    if (match) return oauthMetadata(origin, match[1]);
    return new Response(null, { status: 404 });
  } catch {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
}
