import { CLIENT_PROTOCOL } from '../storage/protocol.ts';
import {
  AccountActionError,
  type AccountUser,
  type PasswordRecovery,
} from './client.ts';
export async function accountAction(action: string, data: object = {}) {
  if (['logout', 'password'].includes(action)) {
    const { accountRepository } = await import('../repository');
    await accountRepository.flush?.();
  }
  const response = await fetch('/api/account/' + action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Context-Hub': '1',
      'X-Context-Hub-Version': CLIENT_PROTOCOL,
    },
    body: JSON.stringify(data),
  });
  const result = (await response.json()) as {
    error?: string;
    user?: AccountUser;
    passwordRecovery?: PasswordRecovery;
  };
  if (!response.ok)
    throw new AccountActionError(
      result.error ?? '账号操作失败。',
      result.passwordRecovery,
    );
  return result;
}
