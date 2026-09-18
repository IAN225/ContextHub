import { readTextBody } from '../../server/body.ts';
import { ImportError } from '../contracts.ts';

export function readLimitedBody(response: Response | Request, limit: number) {
  return readTextBody(response, limit, {
    tooLarge: () =>
      new ImportError('TOO_LARGE', '内容超过大小限制，请分批导入。', 413),
  });
}
