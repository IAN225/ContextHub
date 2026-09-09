import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankWorkspace, inboxUploads } from '../lib/domain.ts';
import {
  applyHubCommand,
  normalizeHubState,
  type HubState,
} from '../lib/hub-state.ts';
import { importManual } from '../lib/imports/manual.ts';
import { normalizeImportDraft } from '../lib/imports/draft.ts';

void test('link inbox content survives reload and archives once without changing source data', () => {
  const link = {
    ...importManual('用户：linked question\n助手：linked answer'),
    channel: 'link' as const,
    source: 'ChatGPT 分享链接',
  };
  let state: HubState = {
    schemaVersion: 1,
    workspaces: [blankWorkspace('target')],
    uploads: [],
  };
  state = applyHubCommand(state, { type: 'upload/add', upload: link });
  state = normalizeHubState(JSON.parse(JSON.stringify(state)));
  assert.equal(inboxUploads(state.uploads).length, 1);
  assert.equal(inboxUploads(state.uploads)[0].source, link.source);
  const command = {
    type: 'upload/archive' as const,
    uploadId: link.id,
    target: state.workspaces[0].id,
    batchId: 'linked-batch',
  };
  state = applyHubCommand(state, command);
  state = applyHubCommand(state, command);
  assert.equal(inboxUploads(state.uploads).length, 0);
  assert.equal(state.workspaces[0].turns.length, 1);
  assert.deepEqual(
    state.workspaces[0].turns[0].messages,
    link.turns[0].messages,
  );
  assert.equal(
    state.workspaces[0].turns[0].provenance?.parser,
    link.provenance?.parser,
  );
});

void test('a server retry never replaces edited pending content or resurrects an archived delivery', () => {
  let state: HubState = {
    schemaVersion: 1,
    workspaces: [blankWorkspace('target')],
    uploads: [],
  };
  const upload = {
    ...importManual('用户：question\n助手：answer'),
    channel: 'api' as const,
  };
  state = applyHubCommand(state, { type: 'upload/receive', uploads: [upload] });
  assert.equal(state.uploads.length, 1);
  state = applyHubCommand(state, {
    type: 'upload/update',
    upload: { ...upload, title: 'edited preview' },
  });
  const beforeRetry = state;
  state = applyHubCommand(state, { type: 'upload/receive', uploads: [upload] });
  assert.equal(state, beforeRetry);
  assert.equal(state.uploads[0].title, 'edited preview');
  state = applyHubCommand(state, {
    type: 'upload/archive',
    uploadId: upload.id,
    target: state.workspaces[0].id,
    batchId: 'batch',
  });
  state = normalizeHubState(JSON.parse(JSON.stringify(state)));
  state = applyHubCommand(state, { type: 'upload/receive', uploads: [upload] });
  assert.equal(state.uploads.length, 0);
  assert.equal(state.workspaces[0].turns.length, 1);
  assert.equal(state.workspaces[0].turns[0].provenance?.parser, 'manual-text');
});
void test('manual drafts load independently of API inbox and older state keeps its data', () => {
  const upload = importManual('user: hello');
  const state = normalizeHubState({
    workspaces: [blankWorkspace('target')],
    uploads: [upload],
  });
  assert.equal(state.uploads[0].channel, 'manual');
  assert.equal(state.deliveryReceipts, undefined);
});
void test('old local JSON drafts become visible manual input without reviving deliberately cleared text', () => {
  const old = {
    tab: 'api',
    json: '{"messages":[]}',
    title: 'saved title',
    link: 'saved link',
    protocol: 'chat',
  };
  const migrated = normalizeImportDraft(old);
  assert.equal(migrated.text, old.json);
  assert.equal(migrated.title, old.title);
  assert.equal(migrated.link, old.link);
  assert.equal(normalizeImportDraft({ ...old, text: '' }).text, '');
});
