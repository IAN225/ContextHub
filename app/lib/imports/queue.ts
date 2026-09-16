import { type Upload, type UploadChannel } from '../core/model.ts';

export function pendingUploads(
  uploads: Upload[],
  channel: UploadChannel,
  workspaceId?: string,
) {
  return uploads.filter((u) => {
    // Resolve older browser data without rewriting its source or provenance.
    const origin = uploadChannel(u);
    return (
      origin === channel && (!workspaceId || u.workspaceId === workspaceId)
    );
  });
}

export function inboxUploads(uploads: Upload[]) {
  return uploads.filter((u) => {
    const channel = uploadChannel(u);
    return channel === 'api' || channel === 'link';
  });
}

export function uploadChannel(u: Upload): UploadChannel {
  return u.kind === 'summary'
    ? 'workbench'
    : (u.channel ??
        (/^\/v1\/(chat\/completions|responses|messages)$/.test(u.source)
          ? 'api'
          : 'link'));
}
