import { env } from 'cloudflare:workers';
import { createD1ImportRepository } from './repository.ts';

export function importRepository() {
  const binding = (env as unknown as { DB?: D1Database }).DB;
  if (!binding) throw new Error('Import database binding missing');
  return createD1ImportRepository(binding);
}
