import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAccessStore } from './server/access-store.mjs';
import { openAccounts } from './server/accounts.mjs';
import { initializeOrigin } from './server/initialize-origin.mjs';
const directory = resolve(
  process.env.CONTEXT_HUB_SERVER_DATA_DIR ||
    fileURLToPath(new URL('../.wrangler/server', import.meta.url)),
);
const access = await openAccessStore(directory);
const accounts = await openAccounts(directory, access.bootstrapAdmin);
try {
  const result = await accounts.initializeDeployment();
  await initializeOrigin(access);
  console.log(
    result.passwordFile
      ? '初始管理员：admin；随机密码文件：' + result.passwordFile
      : result.activated
        ? '已有实例保持激活，账号与密码未更改。'
        : '实例等待管理员首次登录激活。',
  );
} finally {
  accounts.close();
}
