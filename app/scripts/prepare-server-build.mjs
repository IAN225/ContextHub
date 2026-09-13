import { readFile, writeFile } from 'node:fs/promises';
const path = new URL('../dist/server/wrangler.json', import.meta.url);
const config = JSON.parse(await readFile(path, 'utf8'));
const binding = config.d1_databases?.find((item) => item.binding === 'DB');
if (!binding) throw new Error('Built DB binding missing');
binding.migrations_dir = '../../drizzle';
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log('Prepared portable database migration path.');
