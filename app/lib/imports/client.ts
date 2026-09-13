export async function importRequest<T>(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/imports/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    headers: {
      'X-Context-Hub': '1',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error('导入服务未返回有效结果，请检查本地服务是否已启动。');
  }
  if (!response.ok) {
    const error = result as { error?: { message?: string } };
    throw new Error(
      error?.error?.message || `导入请求失败（${response.status}）`,
    );
  }
  return result as T;
}
