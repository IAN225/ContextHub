import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAccounts } from './server/accounts.mjs';
const [action, username, passwordFile] = process.argv.slice(2);
const directory = resolve(
  process.env.CONTEXT_HUB_SERVER_DATA_DIR ||
    fileURLToPath(new URL('../.wrangler/server', import.meta.url)),
);
const store = await openAccounts(directory);
try {
  if (action === 'list') console.log(JSON.stringify(store.list(), null, 2));
  else if (
    ['create', 'reset-password'].includes(action) &&
    username &&
    passwordFile
  ) {
    // Keep passwords out of process arguments and shell history.
    const password = (await readFile(passwordFile, 'utf8')).trimEnd();
    if (action === 'create')
      console.log(JSON.stringify(await store.create(username, password)));
    else {
      await store.resetPassword(username, password);
      console.log('Password reset; existing sessions revoked.');
    }
  } else
    throw new Error(
      'Usage: node scripts/accounts.mjs list | create USER PASSWORD_FILE | reset-password USER PASSWORD_FILE',
    );
} finally {
  store.close();
}
