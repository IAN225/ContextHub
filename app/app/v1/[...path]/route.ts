import {
  deliveryOptions,
  importResponse,
  listDeliveryModels,
  receiveDelivery,
} from '@/lib/imports/server/handlers';
import { importRepository } from '@/lib/imports/server/runtime';
import { ImportError } from '@/lib/imports/contracts';
import { protocols } from '@/lib/imports/protocols';

export const OPTIONS = deliveryOptions;
export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return importResponse(
    async () => {
      if ((await context.params).path.join('/') !== 'models')
        throw new ImportError('NOT_FOUND', '接口不存在。', 404);
      return listDeliveryModels(request, importRepository());
    },
    true,
    request,
  );
}
export async function POST(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  return importResponse(
    async () => {
      const path = `/v1/${(await context.params).path.join('/')}`;
      const protocol = protocols.find((p) => p.path === path);
      if (!protocol)
        throw new ImportError('NOT_FOUND', '不支持的对话投递接口。', 404);
      return receiveDelivery(request, protocol.id, importRepository());
    },
    true,
    request,
  );
}
