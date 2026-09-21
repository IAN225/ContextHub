import type { WorkspaceApplication } from '../../application/server/workspaces.ts';
import { type Upload } from '../../core/model.ts';
import type { SQLiteDatabase } from '../../server/sqlite.ts';
import { ImportError, MAX_PENDING_IMPORT_BYTES } from '../contracts.ts';

export type Owner = { id: string; key_hash: string | null };
type Receipt = {
  id: string;
  content_hash: string;
  acknowledged_at: number | null;
};
export interface ImportRepository {
  accountOwner(id: string): Promise<Owner>;
  findDeliveryOwner(keyHash: string): Promise<Owner | null>;
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

export function createImportRepository(
  db: SQLiteDatabase,
  application: WorkspaceApplication,
): ImportRepository {
  const sql = db.raw;
  const ownerRow = (id: string) =>
    sql
      .prepare('SELECT id,key_hash FROM import_owners WHERE id=?')
      .get(id) as Owner;
  return {
    async accountOwner(id) {
      application.requireOwner(id);
      sql
        .prepare(
          'INSERT INTO import_owners(id,session_hash,key_hash,created_at) VALUES(?,?,NULL,?) ON CONFLICT(id) DO NOTHING',
        )
        .run(id, 'account:' + id, Date.now());
      return ownerRow(id);
    },
    async findDeliveryOwner(hash) {
      const owner = sql
        .prepare('SELECT id,key_hash FROM import_owners WHERE key_hash=?')
        .get(hash) as Owner | null;
      if (owner) {
        try {
          application.requireOwner(owner.id);
        } catch {
          return null;
        }
      }
      return owner ?? null;
    },
    async rotateKey(id, key) {
      application.requireOwner(id);
      sql
        .prepare('UPDATE import_owners SET key_hash=? WHERE id=?')
        .run(key, id);
    },
    async enqueue(owner, requestKey, contentHash, upload) {
      return db.transaction(() => {
        const snapshot = application.read(owner.id);
        if (ownerRow(owner.id)?.key_hash !== owner.key_hash)
          throw new ImportError('INVALID_KEY', '投递密钥已失效。', 401);
        const prior = sql
          .prepare(
            'SELECT id,content_hash,acknowledged_at FROM import_deliveries WHERE owner_id=? AND request_key=?',
          )
          .get(owner.id, requestKey) as Receipt | undefined;
        if (prior) {
          if (prior.content_hash !== contentHash)
            throw new ImportError(
              'IDEMPOTENCY_CONFLICT',
              '投递编号已用于不同内容。',
              409,
            );
          return { ...prior };
        }
        const pending = snapshot.state.uploads.filter(
          (u) => u.channel === 'api',
        );
        if (
          pending.length >= 200 ||
          new TextEncoder().encode(JSON.stringify(pending)).length +
            new TextEncoder().encode(JSON.stringify(upload)).length >
            MAX_PENDING_IMPORT_BYTES
        )
          throw new ImportError(
            'INBOX_FULL',
            '待处理收件已达上限，请归档或删除后重试。',
            507,
          );
        application.apply(owner.id, snapshot, { type: 'upload/add', upload });
        const at = Date.now();
        sql
          .prepare(
            'INSERT INTO import_deliveries(id,owner_id,request_key,content_hash,upload_json,byte_length,created_at,acknowledged_at) VALUES(?,?,?,?,NULL,0,?,?)',
          )
          .run(upload.id, owner.id, requestKey, contentHash, at, at);
        return {
          id: upload.id,
          content_hash: contentHash,
          acknowledged_at: at,
        };
      });
    },
    async pending(owner) {
      return application
        .read(owner)
        .state.uploads.filter((u) => u.channel === 'api');
    },
    async acknowledge() {
      throw new ImportError(
        'UPGRADE_REQUIRED',
        '服务已升级，请刷新页面。',
        426,
      );
    },
  };
}
