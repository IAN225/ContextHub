import { digest, randomSecret } from '../../server/crypto.ts';
import type { SqlDatabase } from '../../server/database.ts';
import { SummaryError } from '../contracts.ts';
import type { SummaryEngine } from '../engines.ts';
import {
  normalizeBaseUrl,
  readSummaryConnection,
  summaryConnectionStatus,
  type SummaryEnvironment,
} from './config.ts';

export type SavedSummarySettings = {
  env: SummaryEnvironment;
  revision: string;
  source: 'local' | 'environment';
};
export function publicSummarySettings(settings: SavedSummarySettings) {
  return {
    ...summaryConnectionStatus(settings.env),
    keyConfigured: Boolean(settings.env.CONTEXT_HUB_SUMMARY_API_KEY?.trim()),
    revision: settings.revision,
    source: settings.source,
    editable: true,
  };
}
export function summarySettingsRepository(
  db: SqlDatabase,
  owner: string,
  engine: SummaryEngine = 'custom',
  commit?: (
    query: string,
    parameters: (string | number | null)[],
  ) => Promise<{ meta: { changes: number } }>,
) {
  if (!owner) throw new SummaryError('UNAUTHORIZED', '请先登录。', 401);
  const isolated = engine === 'reme';
  const isolatedOwner = 'account:' + owner;
  async function read(
    _environment: SummaryEnvironment,
  ): Promise<SavedSummarySettings> {
    const row = await db
      .prepare(
        isolated
          ? 'SELECT value,revision FROM summary_engine_settings WHERE owner_id=? AND engine=?'
          : 'SELECT value,revision FROM account_summary_settings WHERE user_id=?',
      )
      .bind(...(isolated ? [isolatedOwner, engine] : [owner]))
      .first<{ value: string; revision: string }>();
    if (row) {
      try {
        const env = JSON.parse(row.value) as SummaryEnvironment;
        readSummaryConnection(env);
        return { env, revision: row.revision, source: 'local' };
      } catch {
        throw new SummaryError(
          'INVALID_SAVED_CONNECTION',
          '已保存的模型连接无法读取，请检查本地服务配置。',
          503,
        );
      }
    }
    const env: SummaryEnvironment = {};
    return {
      env,
      revision: await digest(JSON.stringify(env)),
      source: 'environment',
    };
  }
  return {
    read,
    async save(value: unknown, environment: SummaryEnvironment) {
      const input =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      if (
        !['baseUrl', 'model', 'protocol', 'apiKey', 'revision'].every(
          (key) => typeof input[key] === 'string',
        )
      )
        throw new SummaryError(
          'INVALID_CONNECTION',
          '请填写接口地址、模型与协议。',
        );
      const current = await read(environment);
      if (input.revision !== current.revision)
        throw new SummaryError(
          'CONNECTION_CHANGED',
          '模型连接已在其他页面更新，请重新读取连接后再保存。',
          409,
        );
      const baseUrl = normalizeBaseUrl(String(input.baseUrl).trim());
      if (new URL(baseUrl).protocol !== 'https:')
        throw new SummaryError(
          'INVALID_CONNECTION',
          '云端账号的模型接口必须使用公网 HTTPS。',
        );
      if (baseUrl.length > 2048)
        throw new SummaryError('INVALID_CONNECTION', '接口地址过长。');
      const protocol = String(input.protocol);
      let sameDestination = false;
      try {
        sameDestination =
          baseUrl ===
            normalizeBaseUrl(current.env.CONTEXT_HUB_SUMMARY_BASE_URL || '') &&
          protocol === (current.env.CONTEXT_HUB_SUMMARY_PROTOCOL || 'openai');
      } catch {
        /* A malformed legacy file must not prevent a new valid setup. */
      }
      const supplied = String(input.apiKey).trim();
      if (!supplied && !sameDestination)
        throw new SummaryError(
          'KEY_REQUIRED',
          '首次配置或更换接口地址/协议时，请填写对应的 API Key。',
        );
      const key = supplied || current.env.CONTEXT_HUB_SUMMARY_API_KEY || '';
      if (!key || key.length > 8192 || !/^[\x21-\x7e]+$/.test(key))
        throw new SummaryError('INVALID_API_KEY', 'API Key 为空或格式无效。');
      const env: SummaryEnvironment = {
        CONTEXT_HUB_SUMMARY_BASE_URL: baseUrl,
        CONTEXT_HUB_SUMMARY_MODEL: String(input.model).trim(),
        CONTEXT_HUB_SUMMARY_PROTOCOL: protocol,
        CONTEXT_HUB_SUMMARY_API_KEY: key,
        CONTEXT_HUB_SUMMARY_THINKING: sameDestination
          ? current.env.CONTEXT_HUB_SUMMARY_THINKING
          : undefined,
      };
      readSummaryConnection(env);
      const revision = randomSecret('');
      const query = isolated
        ? 'INSERT INTO summary_engine_settings(owner_id,engine,value,revision) VALUES(?,?,?,?) ON CONFLICT(owner_id,engine) DO UPDATE SET value=excluded.value,revision=excluded.revision WHERE summary_engine_settings.revision=?'
        : 'INSERT INTO account_summary_settings(user_id,value,revision) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value,revision=excluded.revision WHERE account_summary_settings.revision=?';
      const parameters = [
        ...(isolated ? [isolatedOwner, engine] : [owner]),
        JSON.stringify(env),
        revision,
        current.revision,
      ];
      const result = commit
        ? await commit(query, parameters)
        : await db
            .prepare(query)
            .bind(...parameters)
            .run();
      if (!result.meta.changes)
        throw new SummaryError(
          'CONNECTION_CHANGED',
          '模型连接已更新，请重新读取后再保存。',
          409,
        );
      return publicSummarySettings({ env, revision, source: 'local' });
    },
  };
}
export type SummarySettingsRepository = ReturnType<
  typeof summarySettingsRepository
>;
