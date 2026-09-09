import type { Upload } from '../../domain.ts';
import { ImportError } from '../contracts.ts';

export type Owner = { id: string; key_hash: string | null };
type Receipt = {
  id: string;
  content_hash: string;
  acknowledged_at: number | null;
};
export interface ImportRepository {
  findOwner(sessionHash: string): Promise<Owner | null>;
  findDeliveryOwner(keyHash: string): Promise<Owner | null>;
  createOwner(id: string, sessionHash: string, keyHash: string): Promise<void>;
  rotateKey(ownerId: string, keyHash: string | null): Promise<void>;
  enqueue(
    owner: Owner,
    requestKey: string,
    contentHash: string,
    upload: Upload,
  ): Promise<Receipt>;
  pending(ownerId: string): Promise<Upload[]>;
  acknowledge(ownerId: string, ids: string[]): Promise<void>;
}

export function createD1ImportRepository(db: D1Database): ImportRepository {
  return {
    findOwner: (sessionHash) =>
      db
        .prepare(
          'SELECT id, key_hash FROM import_owners WHERE session_hash = ?',
        )
        .bind(sessionHash)
        .first<Owner>(),
    findDeliveryOwner: (keyHash) =>
      db
        .prepare('SELECT id, key_hash FROM import_owners WHERE key_hash = ?')
        .bind(keyHash)
        .first<Owner>(),
    async createOwner(id, sessionHash, keyHash) {
      await db
        .prepare(
          'INSERT INTO import_owners (id, session_hash, key_hash, created_at) VALUES (?, ?, ?, ?)',
        )
        .bind(id, sessionHash, keyHash, Date.now())
        .run();
    },
    async rotateKey(ownerId, keyHash) {
      await db
        .prepare('UPDATE import_owners SET key_hash = ? WHERE id = ?')
        .bind(keyHash, ownerId)
        .run();
    },
    async enqueue(owner, requestKey, contentHash, upload) {
      const body = JSON.stringify(upload);
      // Quotas, key revocation, and idempotency are checked in the same SQLite write.
      await db
        .prepare(`INSERT INTO import_deliveries
        (id, owner_id, request_key, content_hash, upload_json, byte_length, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM import_owners WHERE id = ? AND key_hash = ?)
          AND (SELECT COUNT(*) FROM import_deliveries WHERE owner_id = ? AND acknowledged_at IS NULL) < 100
          AND (SELECT COALESCE(SUM(byte_length), 0) FROM import_deliveries WHERE owner_id = ? AND acknowledged_at IS NULL) + ? <= 20971520
        ON CONFLICT(owner_id, request_key) DO NOTHING`)
        .bind(
          upload.id,
          owner.id,
          requestKey,
          contentHash,
          body,
          new TextEncoder().encode(body).length,
          Date.now(),
          owner.id,
          owner.key_hash,
          owner.id,
          owner.id,
          new TextEncoder().encode(body).length,
        )
        .run();
      const receipt = await db
        .prepare(
          'SELECT id, content_hash, acknowledged_at FROM import_deliveries WHERE owner_id = ? AND request_key = ?',
        )
        .bind(owner.id, requestKey)
        .first<Receipt>();
      if (receipt) {
        if (receipt.content_hash !== contentHash)
          throw new ImportError(
            'IDEMPOTENCY_CONFLICT',
            '相同投递编号对应了不同内容，请使用新的 Idempotency-Key。',
            409,
          );
        return receipt;
      }
      const active = await db
        .prepare('SELECT id FROM import_owners WHERE id = ? AND key_hash = ?')
        .bind(owner.id, owner.key_hash)
        .first();
      if (!active)
        throw new ImportError(
          'INVALID_KEY',
          '投递 Key 已失效，请更新客户端配置。',
          401,
        );
      throw new ImportError(
        'INBOX_FULL',
        '待接收内容已达上限，请打开 Context Hub 接收后重试。',
        507,
      );
    },
    async pending(ownerId) {
      const rows = await db
        .prepare(
          'SELECT upload_json FROM import_deliveries WHERE owner_id = ? AND acknowledged_at IS NULL ORDER BY created_at, id LIMIT 5',
        )
        .bind(ownerId)
        .all<{ upload_json: string }>();
      return rows.results.map((r) => JSON.parse(r.upload_json) as Upload);
    },
    async acknowledge(ownerId, ids) {
      if (!ids.length) return;
      // Keep just the receipt for retries; remove the server's conversation copy.
      await db
        .prepare(
          `UPDATE import_deliveries SET upload_json = NULL, byte_length = 0, acknowledged_at = COALESCE(acknowledged_at, ?) WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        )
        .bind(Date.now(), ownerId, ...ids)
        .run();
    },
  };
}
