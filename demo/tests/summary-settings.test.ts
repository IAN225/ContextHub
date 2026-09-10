import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  summarySettingsRepository,
  publicSummarySettings,
} from '../lib/summary/server/settings.ts';
import { createSummaryHandler } from '../lib/summary/server/handlers.ts';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(
      new URL('../drizzle/0002_summary_settings.sql', import.meta.url),
      'utf8',
    ),
  );
  const binding = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bind = (...args: SQLInputValue[]) => ({
        first: async () => statement.get(...args) ?? null,
        run: async () => ({
          meta: { changes: statement.run(...args).changes },
        }),
      });
      return { bind, ...bind() };
    },
  } as unknown as D1Database;
  return { db, repository: summarySettingsRepository(binding) };
}
const environment = {
  CONTEXT_HUB_SUMMARY_BASE_URL: 'https://model.example/v1',
  CONTEXT_HUB_SUMMARY_MODEL: 'old-model',
  CONTEXT_HUB_SUMMARY_API_KEY: 'synthetic-file-key',
  CONTEXT_HUB_SUMMARY_PROTOCOL: 'openai',
};
const input = {
  baseUrl: 'https://model.example/v1',
  model: 'new-model',
  protocol: 'openai',
  apiKey: '',
};
void test('page settings keep existing key for the same destination, stay server-only and reject stale writes', async (t) => {
  const { db, repository } = setup();
  t.after(() => db.close());
  const initial = await repository.read(environment);
  const saved = await repository.save(
    { ...input, revision: initial.revision },
    environment,
  );
  assert.equal(saved.ready, true);
  assert.equal(saved.source, 'local');
  assert.equal(saved.keyConfigured, true);
  assert.ok(
    !JSON.stringify(saved).includes(environment.CONTEXT_HUB_SUMMARY_API_KEY),
  );
  const current = await repository.read({
    ...environment,
    CONTEXT_HUB_SUMMARY_API_KEY: 'changed-file-key',
  });
  assert.equal(
    current.env.CONTEXT_HUB_SUMMARY_API_KEY,
    environment.CONTEXT_HUB_SUMMARY_API_KEY,
  );
  await assert.rejects(
    repository.save(
      { ...input, model: 'stale', revision: initial.revision },
      environment,
    ),
    /其他页面/,
  );
  assert.equal(
    (await repository.read(environment)).env.CONTEXT_HUB_SUMMARY_MODEL,
    'new-model',
  );
});
void test('first setup and destination changes require a supplied key; invalid input cannot replace saved credentials', async (t) => {
  const { db, repository } = setup();
  t.after(() => db.close());
  const initial = await repository.read({});
  await assert.rejects(
    repository.save({ ...input, revision: initial.revision }, {}),
    /API Key/,
  );
  const saved = await repository.save(
    { ...input, apiKey: 'synthetic-first-key', revision: initial.revision },
    {},
  );
  for (const patch of [
    { baseUrl: 'https://other.example' },
    { protocol: 'responses' },
    { apiKey: 'bad\nheader' },
  ])
    await assert.rejects(
      repository.save({ ...input, ...patch, revision: saved.revision }, {}),
    );
  const changed = await repository.save(
    {
      ...input,
      baseUrl: 'https://other.example',
      apiKey: 'synthetic-new-key',
      revision: saved.revision,
    },
    {},
  );
  assert.equal(changed.baseUrl, 'https://other.example');
  assert.equal(
    (await repository.read({})).env.CONTEXT_HUB_SUMMARY_API_KEY,
    'synthetic-new-key',
  );
});
void test('same-origin configuration route saves without calling a model and never returns plaintext keys', async (t) => {
  const { db, repository } = setup();
  t.after(() => db.close());
  const handler = createSummaryHandler();
  const initial = publicSummarySettings(await repository.read(environment));
  const body = {
    ...input,
    apiKey: 'synthetic-page-key',
    revision: initial.revision,
  };
  const request = (origin: string, value: unknown) =>
    new Request('http://localhost/api/summary/connection', {
      method: 'POST',
      headers: {
        origin,
        'x-context-hub': '1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(value),
    });
  const fetcher = (() => {
    throw new Error('Saving settings must not call a model');
  }) as typeof fetch;
  const denied = await handler(
    request('https://outside.example', body),
    'connection',
    environment,
    fetcher,
    repository,
  );
  assert.equal(denied.status, 403);
  const saved = await handler(
    request('http://localhost', body),
    'connection',
    environment,
    fetcher,
    repository,
  );
  assert.equal(saved.status, 200);
  assert.ok(!(await saved.text()).includes(body.apiKey));
  const get = new Request('http://localhost/api/summary/connection', {
    headers: { 'x-context-hub': '1' },
  });
  const status = await handler(
    get,
    'connection',
    environment,
    fetcher,
    repository,
  );
  assert.ok(!(await status.text()).includes(body.apiKey));
});
