import { preserveFetchedAttachments } from '../../attachments.ts';
import { deliveryTriggerTurn } from '../../imports/delivery-review.ts';
import { summaryTrack, summaryWorkspace } from '../../summary/engines.ts';
import { restoreSummary } from '../../summary/restore.ts';
import { type HubCommand, type HubState } from '../contracts.ts';

export function applyUploads(
  state: HubState,
  command: Extract<
    HubCommand,
    {
      type:
        | 'upload/add'
        | 'upload/receive'
        | 'upload/update'
        | 'upload/remove'
        | 'upload/archive'
        | 'upload/summary';
    }
  >,
): HubState {
  switch (command.type) {
    case 'upload/add':
      return {
        ...state,
        uploads: [
          command.upload,
          ...state.uploads.filter((u) => u.id !== command.upload.id),
        ],
      };
    case 'upload/receive': {
      const receipts = new Set(state.deliveryReceipts ?? []);
      const existing = new Set(state.uploads.map((u) => u.id));
      const incoming = command.uploads.filter(
        (u) => !receipts.has(u.id) && !existing.has(u.id),
      );
      const changed = command.uploads.some((u) => !receipts.has(u.id));
      if (!changed) return state;
      for (const upload of command.uploads) receipts.add(upload.id);
      return {
        ...state,
        uploads: [...incoming, ...state.uploads],
        deliveryReceipts: [...receipts],
      };
    }
    case 'upload/update':
      return {
        ...state,
        uploads: state.uploads.map((u) =>
          u.id === command.upload.id
            ? {
                ...command.upload,
                turns: command.upload.turns.map((t) => ({
                  ...t,
                  attachments: preserveFetchedAttachments(
                    t.attachments,
                    u.turns.find((old) => old.id === t.id)?.attachments,
                  ),
                })),
              }
            : u,
        ),
      };
    case 'upload/remove':
      return {
        ...state,
        uploads: state.uploads.filter((u) => u.id !== command.uploadId),
      };
    case 'upload/archive': {
      const upload = state.uploads.find((u) => u.id === command.uploadId);
      if (!upload) return state;
      if (upload.kind !== 'conversation')
        throw new Error('候选摘要不能归档为原文。');
      const target = command.target;
      const current =
        typeof target === 'string'
          ? state.workspaces.find((w) => w.id === target)
          : target;
      if (!current) throw new Error('归档目标已不存在，收件已保留。');
      if (
        command.excludedTriggerId &&
        deliveryTriggerTurn(upload)?.id !== command.excludedTriggerId
      )
        throw new Error('投递末尾消息已变化，请重新检查预览后归档。');
      const includedTurns = upload.turns.filter(
        (t) => t.id !== command.excludedTriggerId,
      );
      if (!includedTurns.length)
        throw new Error('没有可归档的轮次，收件已保留。');
      const turns = includedTurns.map((t, i) => ({
        ...t,
        id: `${command.batchId}-${i}`,
      }));
      const next = { ...current, turns: [...current.turns, ...turns] };
      return {
        ...state,
        uploads: state.uploads.filter((u) => u.id !== upload.id),
        workspaces:
          typeof target === 'string'
            ? state.workspaces.map((w) => (w.id === current.id ? next : w))
            : [...state.workspaces, next],
      };
    }
    case 'upload/summary': {
      const upload = state.uploads.find((u) => u.id === command.uploadId);
      if (!upload) return state;
      const current = state.workspaces.find(
        (w) => w.id === command.workspaceId,
      );
      if (
        !current ||
        upload.kind !== 'summary' ||
        (upload.workspaceId && upload.workspaceId !== current.id)
      )
        throw new Error('候选摘要与工作区不匹配，候选已保留。');
      const summary = {
        id: `candidate-${upload.id}`,
        title: upload.title,
        text: upload.summaryText ?? '',
        covered: upload.covered ?? [],
        createdAt: command.at,
      };
      const scoped = summaryWorkspace(
        current,
        upload.summaryEngine ?? 'custom',
      );
      const restored = restoreSummary(
        { ...scoped, summaries: [...scoped.summaries, summary].slice(-30) },
        summary.id,
        command.mode,
      );
      const next =
        upload.summaryEngine === 'reme'
          ? { ...current, reme: summaryTrack(restored) }
          : { ...current, ...summaryTrack(restored) };
      return {
        ...state,
        uploads: state.uploads.filter((u) => u.id !== upload.id),
        workspaces: state.workspaces.map((w) =>
          w.id === current.id ? next : w,
        ),
      };
    }
  }
}
