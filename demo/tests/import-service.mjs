import assert from 'node:assert/strict';

// Independent synthetic sessions: never uses browser cookies, user keys, or real chats.
const base = process.env.IMPORT_BASE_URL || 'http://127.0.0.1:3002';
const nativeFetch = globalThis.fetch;
async function fetch(url, init = {}) {
  try {
    const response = await nativeFetch(url, {
      ...init,
      signal: AbortSignal.timeout(10000),
    });
    // Drain every real socket response, including responses checked only for status.
    const bytes = await response.arrayBuffer();
    return new Response(response.status === 204 ? null : bytes, {
      status: response.status,
      headers: response.headers,
    });
  } catch (e) {
    throw new Error(
      `${init.method || 'GET'} ${new URL(url).pathname}: ${e.name}`,
    );
  }
}
async function manage(action, body, cookie = '', extras = {}) {
  return fetch(`${base}/api/imports/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Context-Hub': '1',
      'Content-Type': 'application/json',
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...extras,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function session() {
  const response = await manage('delivery', { action: 'rotate' });
  assert.equal(response.status, 200, 'session setup');
  const data = await response.json();
  assert.ok(data.enabled && typeof data.key === 'string');
  return {
    cookie: response.headers.get('set-cookie').split(';')[0],
    key: data.key,
  };
}
const a = await session();
const b = await session();
async function send(path, body, key = a.key, extra = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
async function pending(cookie) {
  const response = await manage('inbox', undefined, cookie);
  assert.equal(response.status, 200);
  return (await response.json()).uploads;
}
async function ackAll(cookie) {
  for (;;) {
    const uploads = await pending(cookie);
    if (!uploads.length) break;
    assert.equal(
      (await manage('ack', { ids: uploads.map((u) => u.id) }, cookie)).status,
      200,
    );
  }
}
try {
  console.log('CHECK authentication and discovery');
  assert.equal(
    (
      await manage('delivery', { action: 'revoke' }, a.cookie, {
        Origin: 'https://other.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (await send('/v1/chat/completions', { messages: [] }, 'bad-key')).status,
    401,
  );
  assert.equal((await fetch(base + '/v1/models')).status, 401);
  const models = await fetch(base + '/v1/models', {
    headers: { Authorization: `Bearer ${a.key}` },
  });
  assert.equal(models.status, 200);
  assert.equal((await models.json()).data[0].id, 'context-hub');
  const preflight = await fetch(base + '/v1/messages', {
    method: 'OPTIONS',
    headers: { Origin: 'https://client.example' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const messages = [
    { role: 'user', content: 'synthetic question' },
    { role: 'assistant', content: 'synthetic answer' },
  ];
  console.log('CHECK idempotency and owner isolation');
  const chat = { model: 'context-hub', messages };
  const first = await send('/v1/chat/completions', chat, a.key, {
    'Idempotency-Key': 'retry-1',
  });
  assert.equal(first.status, 200);
  const receipt = first.headers.get('x-context-hub-receipt');
  assert.ok(receipt);
  assert.match((await first.json()).choices[0].message.content, /只负责收录/);
  const retry = await send(
    '/v1/chat/completions',
    { ...chat, stream: true },
    a.key,
    { 'Idempotency-Key': 'retry-1' },
  );
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get('x-context-hub-receipt'), receipt);
  assert.match(await retry.text(), /data: \[DONE\]/);
  assert.equal((await pending(a.cookie)).length, 1);
  assert.equal((await pending(b.cookie)).length, 0);
  await manage('ack', { ids: [receipt] }, b.cookie);
  assert.equal((await pending(a.cookie)).length, 1);
  assert.equal(
    (
      await send(
        '/v1/chat/completions',
        { messages: [{ role: 'user', content: 'changed' }] },
        a.key,
        { 'Idempotency-Key': 'retry-1' },
      )
    ).status,
    409,
  );
  await manage('ack', { ids: [receipt] }, a.cookie);
  assert.equal((await pending(a.cookie)).length, 0);
  assert.equal(
    (
      await send('/v1/chat/completions', chat, a.key, {
        'Idempotency-Key': 'retry-1',
      })
    ).status,
    200,
  );
  assert.equal(
    (await pending(a.cookie)).length,
    0,
    'acknowledged retries stay consumed',
  );
  for (const stream of [false, true]) {
    console.log(`CHECK Responses and Messages stream=${stream}`);
    const responses = await send(
      '/v1/responses',
      { model: 'context-hub', input: messages, stream },
      a.key,
      { 'Idempotency-Key': `responses-${stream}` },
    );
    assert.equal(responses.status, 200);
    if (stream) {
      const text = await responses.text();
      assert.match(text, /event: response.completed/);
      assert.match(text, /response.output_text.delta/);
    } else
      assert.equal(
        (await responses.json()).output[0].content[0].type,
        'output_text',
      );
    const anthropic = await fetch(base + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': a.key,
        'Idempotency-Key': `anthropic-${stream}`,
      },
      body: JSON.stringify({ model: 'context-hub', messages, stream }),
    });
    assert.equal(anthropic.status, 200);
    if (stream) assert.match(await anthropic.text(), /event: message_stop/);
    else assert.equal((await anthropic.json()).stop_reason, 'end_turn');
  }
  const invalid = await send('/v1/chat/completions', {
    messages: [{ role: 'assistant', content: 'orphan' }],
  });
  console.log('CHECK invalid requests and key lifecycle');
  assert.equal(invalid.status, 422);
  assert.equal(
    (
      await send('/v1/responses', {
        input: 'q',
        previous_response_id: 'remote-history',
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await send('/v1/chat/completions', {
        messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }],
      })
    ).status,
    413,
  );
  const rotatedResponse = await manage(
    'delivery',
    { action: 'rotate' },
    a.cookie,
  );
  assert.equal(rotatedResponse.status, 200);
  const rotated = await rotatedResponse.json();
  assert.equal((await send('/v1/chat/completions', chat)).status, 401);
  assert.equal(
    (await send('/v1/chat/completions', chat, rotated.key)).status,
    200,
  );
  await manage('delivery', { action: 'revoke' }, a.cookie);
  console.log('CHECK revoked key and retained queue');
  assert.equal(
    (await send('/v1/chat/completions', chat, rotated.key)).status,
    401,
  );
  assert.ok(
    (await pending(a.cookie)).length > 0,
    'revoking preserves accepted contents',
  );
  console.log(
    'Import HTTP integration passed: protocol responses, SSE, key lifecycle, owner isolation, idempotency, bounded requests, durable acknowledgements.',
  );
} finally {
  console.log('CLEAN synthetic sessions');
  await ackAll(a.cookie);
  await ackAll(b.cookie);
  await manage('delivery', { action: 'revoke' }, a.cookie);
  await manage('delivery', { action: 'revoke' }, b.cookie);
}
