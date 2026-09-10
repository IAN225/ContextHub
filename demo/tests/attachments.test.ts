import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import {
  attachmentContext,
  attachmentFromReference,
  attachmentRevision,
  dataUrlBytes,
  fingerprintAttachment,
  MAX_ATTACHMENT_BYTES,
  storedAttachment,
  preserveFetchedAttachments,
} from '../lib/attachments.ts';
import { blankWorkspace, memoryText } from '../lib/domain.ts';
import { parseDelivery } from '../lib/imports/parsers/request-messages.ts';
import { parseChatGPTShare } from '../lib/imports/parsers/chatgpt-share.ts';
import { parseClaudeShare } from '../lib/imports/parsers/claude-share.ts';
import { createImport } from '../lib/imports/contracts.ts';
import { createBackup, parseBackup, restoreBackup } from '../lib/backup.ts';
import { createIndexedDbRepository } from '../lib/repository.ts';
import { applyHubCommand, type HubState } from '../lib/hub-state.ts';
import { planCompression, summaryRevision } from '../lib/summary/planning.ts';
import { summaryTaskWorkspace } from '../lib/tasks/snapshot.ts';

const data = 'data:text/plain;base64,5L+d55WZ6L+Z5Lqb5paH5a2X';
void test('a stale editing draft preserves newly downloaded bytes but explicit removal/replacement wins', async () => {
  const remote = attachmentFromReference({
    name: 'facts.txt',
    url: 'https://files.example/facts.txt',
  });
  const saved = await fingerprintAttachment({
    ...remote,
    url: data,
    sourceUrl: remote.url,
  });
  assert.equal(
    preserveFetchedAttachments(
      [{ ...remote, name: 'renamed.txt' }],
      [saved],
    )?.[0].url,
    data,
  );
  assert.equal(
    preserveFetchedAttachments(
      [{ ...remote, name: 'renamed.txt' }],
      [saved],
    )?.[0].name,
    'renamed.txt',
  );
  assert.deepEqual(preserveFetchedAttachments([], [saved]), []);
  const replaced = { ...remote, url: 'https://files.example/replacement.txt' };
  assert.deepEqual(preserveFetchedAttachments([replaced], [saved]), [replaced]);
});
void test('all request formats retain file bytes/URLs and tool attachment ownership without moving messages', () => {
  for (const [protocol, payload] of [
    [
      'chat',
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                file: { filename: 'facts.txt', file_data: data },
              },
            ],
          },
          {
            role: 'assistant',
            content: 'before',
            tool_calls: [
              { id: 'call', function: { name: 'read', arguments: '{}' } },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'call',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'https://files.example/photo.png' },
              },
            ],
          },
        ],
      },
    ],
    [
      'responses',
      {
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_file', filename: 'facts.txt', file_data: data },
            ],
          },
          {
            type: 'function_call',
            name: 'read',
            call_id: 'call',
            arguments: '{}',
          },
          {
            type: 'function_call_output',
            call_id: 'call',
            output: [
              {
                type: 'input_image',
                image_url: 'https://files.example/photo.png',
              },
            ],
          },
        ],
      },
    ],
    [
      'messages',
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                title: 'facts.txt',
                source: {
                  type: 'base64',
                  media_type: 'text/plain',
                  data: data.split(',')[1],
                },
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool_use', name: 'read', id: 'call', input: {} },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call',
                content: [
                  {
                    type: 'image',
                    source: {
                      type: 'url',
                      url: 'https://files.example/photo.png',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  ] as const) {
    const turns = parseDelivery(payload, protocol);
    assert.equal(turns.length, 1);
    const turn = turns[0];
    assert.equal(turn.attachments?.length, 2);
    assert.equal(turn.attachments[0].status, 'stored');
    assert.equal(turn.attachments[0].text, '保留这些文字');
    assert.equal(turn.attachments[1].status, 'remote');
    assert.deepEqual(turn.messages[0].attachmentIds, [turn.attachments[0].id]);
    assert.equal(turn.messages.at(-1)?.role, 'tool_result');
    assert.deepEqual(turn.messages.at(-1)?.attachmentIds, [
      turn.attachments[1].id,
    ]);
    assert.ok(!JSON.stringify(turn.messages).includes('base64'));
  }
});
void test('share parsers preserve public attachment addresses and distinguish inaccessible provider IDs', () => {
  const claude = createImport(
    parseClaudeShare({
      name: 'files',
      chat_messages: [
        {
          sender: 'human',
          text: 'question',
          attachments: [
            { file_name: 'file.pdf', url: 'https://files.example/file.pdf' },
            { file_name: 'private.txt', uuid: 'provider-private-id' },
          ],
        },
      ],
    }),
    { id: 'claude', label: 'Claude', version: 1 },
    'link',
  );
  assert.equal(claude.turns[0].attachments?.[0].status, 'remote');
  assert.equal(claude.turns[0].attachments?.[1].status, 'missing');
  assert.equal(
    claude.turns[0].attachments?.[1].reference,
    'provider-private-id',
  );
  const html = `<script type="application/json">${JSON.stringify({ mapping: { u: { parent: null, children: [], message: { author: { role: 'user' }, content: { content_type: 'multimodal_text', parts: ['question', { content_type: 'image_asset_pointer', asset_pointer: 'file-service://a' }] }, metadata: { attachments: [{ name: 'data.txt', url: 'https://files.example/data.txt' }] } } } }, current_node: 'u' })}</script>`;
  const chat = createImport(
    parseChatGPTShare(html),
    { id: 'chat', label: 'ChatGPT', version: 1 },
    'link',
  );
  assert.equal(chat.turns[0].attachments?.[0].status, 'missing');
  assert.equal(chat.turns[0].attachments?.[1].status, 'remote');
});
void test('invalid/oversized inline files stay visibly failed and never masquerade as saved content', () => {
  assert.throws(() => dataUrlBytes('data:text/plain;base64,%%%'), /编码/);
  assert.throws(
    () =>
      dataUrlBytes(
        `data:application/octet-stream;base64,${'A'.repeat(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 8)}`,
      ),
    /5 MB/,
  );
  assert.equal(
    attachmentFromReference({ url: 'data:text/plain;base64,%%%' }).status,
    'failed',
  );
  assert.equal(
    attachmentFromReference({ url: 'javascript:alert(1)' }).status,
    'missing',
  );
  assert.equal(
    attachmentFromReference({ url: 'https://user:password@files.example/a' })
      .status,
    'missing',
  );
});
void test('attachment bytes and statuses survive backup; summary and memory receive only available text and metadata', async () => {
  const w = blankWorkspace('files');
  w.turns = parseDelivery(
    {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', file: { filename: 'facts.txt', file_data: data } },
          ],
        },
        { role: 'assistant', content: 'answer' },
        { role: 'user', content: 'retained' },
      ],
    },
    'chat',
  );
  w.config = { ...w.config, configured: true, modelEnabled: true, batch: 1 };
  w.retain = 1;
  const asset = await fingerprintAttachment(w.turns[0].attachments![0]);
  w.turns[0].attachments = [
    asset,
    attachmentFromReference({ name: 'missing.pdf', reference: 'file-id' }),
  ];
  assert.equal(asset.sha256?.length, 64);
  const plan = planCompression(w)!;
  assert.match(plan.input.user, /保留这些文字/);
  assert.ok(!plan.input.user.includes('base64'));
  assert.match(memoryText(w), /保留这些文字/);
  assert.equal(summaryRevision(summaryTaskWorkspace(w)), summaryRevision(w));
  assert.ok(!JSON.stringify(summaryTaskWorkspace(w)).includes('base64'));
  const repo = createIndexedDbRepository(new IDBFactory());
  await repo.write([
    {
      key: 'hub-state-v1',
      value: { schemaVersion: 1, workspaces: [w], uploads: [] },
    },
  ]);
  const backup = parseBackup(JSON.stringify(await createBackup(repo)));
  const factory = new IDBFactory();
  await restoreBackup(createIndexedDbRepository(factory), backup);
  const result = (await createIndexedDbRepository(factory).read(
    'hub-state-v1',
  )) as HubState;
  assert.deepEqual(
    result.workspaces[0].turns[0].attachments,
    JSON.parse(JSON.stringify(w.turns[0].attachments)),
  );
  const context = attachmentContext(asset);
  assert.ok('text' in context);
  assert.equal(context.text, '保留这些文字');
});
void test('download result follows an archived attachment and cannot overwrite replacement, trash or duplicate receipt', () => {
  const original = attachmentFromReference({
    url: 'https://files.example/a.txt',
    name: 'a.txt',
    type: 'text/plain',
  });
  const w = blankWorkspace('target');
  w.turns = [
    {
      id: 'renamed-by-archive',
      title: 'a',
      status: 'normal',
      source: 'link',
      time: null,
      messages: [{ role: 'user', content: 'file' }],
      attachments: [original],
    },
  ];
  const state: HubState = { schemaVersion: 1, workspaces: [w], uploads: [] };
  const result = storedAttachment({
    ...original,
    url: data,
    sourceUrl: original.url,
  });
  const command = {
    type: 'task/attachment' as const,
    taskId: 'attachment-task-0001',
    step: 1,
    expected: attachmentRevision(original),
    attachment: result,
  };
  const updated = applyHubCommand(state, command);
  assert.equal(
    updated.workspaces[0].turns[0].attachments?.[0].status,
    'stored',
  );
  assert.equal(applyHubCommand(updated, command), updated);
  const modified = structuredClone(state);
  modified.workspaces[0].turns[0].attachments![0] = {
    ...original,
    url: 'https://files.example/replaced.txt',
  };
  assert.equal(
    applyHubCommand(modified, command).workspaces[0].turns[0].attachments?.[0]
      .url,
    'https://files.example/replaced.txt',
  );
  const trashed = structuredClone(state);
  trashed.workspaces[0].turns[0].status = 'trash';
  assert.deepEqual(
    applyHubCommand(trashed, command).workspaces[0].turns[0].attachments,
    [original],
  );
});
