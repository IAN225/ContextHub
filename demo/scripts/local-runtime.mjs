// Tool state stays beside the project; these are not application credentials.
import { resolve } from 'node:path';
process.env.WRANGLER_WRITE_LOGS ??= 'false';
process.env.WRANGLER_LOG_PATH ??= resolve('.wrangler/logs');
process.env.MINIFLARE_REGISTRY_PATH ??= resolve('.wrangler/registry');
