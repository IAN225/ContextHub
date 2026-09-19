import { digest } from '../../server/crypto.ts';
import { managementGuard } from '../../server/request.ts';
import { ImportError } from '../contracts.ts';
import type { ImportRepository } from './repository.ts';

export const requireManagementRequest = managementGuard(
  (message) => new ImportError('FORBIDDEN', message, 403),
);
export async function deliveryOwner(request: Request, repo: ImportRepository) {
  const key =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    request.headers.get('x-api-key');
  if (!key || !/^ch_delivery_[a-f0-9]{64}$/.test(key))
    throw new ImportError(
      'INVALID_KEY',
      '请提供有效的 Context Hub 投递 Key。',
      401,
    );
  const owner = await repo.findDeliveryOwner(await digest(key));
  if (!owner)
    throw new ImportError('INVALID_KEY', '投递 Key 无效或已吊销。', 401);
  return owner;
}
