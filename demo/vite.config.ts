import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          migrations_dir: fileURLToPath(new URL('./drizzle', import.meta.url)),
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  // Dev-only secret bindings. Build never reads the private connection file and
  // never embeds its contents in either client assets or the generated config.
  const secretNames = [
    'CONTEXT_HUB_SUMMARY_BASE_URL',
    'CONTEXT_HUB_SUMMARY_MODEL',
    'CONTEXT_HUB_SUMMARY_API_KEY',
    'CONTEXT_HUB_SUMMARY_PROTOCOL',
    'CONTEXT_HUB_SUMMARY_THINKING',
  ];
  if (command === 'serve') {
    const path = fileURLToPath(
      new URL('./.env.summary.local', import.meta.url),
    );
    if (existsSync(path)) {
      const values = parseEnv(readFileSync(path, 'utf8'));
      for (const name of secretNames)
        if (values[name] !== undefined) process.env[name] = values[name];
    }
  }

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: {
          ...localBindingConfig,
          ...(command === 'serve'
            ? { secrets: { required: secretNames } }
            : {}),
        },
      }),
    ],
  };
});
