import { readTextBody } from '../../server/body.ts';
import { ImportError } from '../contracts.ts';

export function readLimitedBody(response: Response | Request, limit: number) {
  return readTextBody(response, limit, {
    tooLarge: () =>
      new ImportError(
        'TOO_LARGE',
        `请求内容超过 ${limit >= 1024 * 1024 ? `${limit / (1024 * 1024)} MiB` : `${limit / 1024} KiB`} 上限（含附件及请求结构）。`,
        413,
      ),
  });
}
