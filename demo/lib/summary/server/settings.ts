import { SummaryError } from '../contracts.ts';
import { digest, randomSecret } from '../../imports/server/auth.ts';
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
export function summarySettingsRepository(db: D1Database) {
  async function read(
    environment: SummaryEnvironment,
  ): Promise<SavedSummarySettings> {
    const row = await db
      .prepare("SELECT value,revision FROM summary_settings WHERE id='summary'")
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
    // Only credential-related bindings enter the fingerprint, not DB or runner keys.
    const env: SummaryEnvironment = {
      CONTEXT_HUB_SUMMARY_BASE_URL: environment.CONTEXT_HUB_SUMMARY_BASE_URL,
      CONTEXT_HUB_SUMMARY_MODEL: environment.CONTEXT_HUB_SUMMARY_MODEL,
      CONTEXT_HUB_SUMMARY_API_KEY: environment.CONTEXT_HUB_SUMMARY_API_KEY,
      CONTEXT_HUB_SUMMARY_PROTOCOL: environment.CONTEXT_HUB_SUMMARY_PROTOCOL,
      CONTEXT_HUB_SUMMARY_THINKING: environment.CONTEXT_HUB_SUMMARY_THINKING,
    };
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
      const result = await db
        .prepare(
          "INSERT INTO summary_settings(id,value,revision) VALUES('summary',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision WHERE summary_settings.revision=?",
        )
        .bind(JSON.stringify(env), revision, current.revision)
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
