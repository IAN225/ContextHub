import type { Workspace } from '../core/model.ts';

/** Exact keys avoid leaking drafts from workspace IDs that share a prefix. */
export function workspaceDraftKeys(w: Workspace) {
  return [
    'connection-draft-' + w.id,
    'new-note-' + w.id,
    'workbench-' + w.id,
    ...['model-draft-', 'model-probes-v2-'].flatMap((prefix) => [
      prefix + w.id,
      prefix + w.id + '-reme',
    ]),
    ...['start', ...w.turns.map((t) => t.id)].map(
      (id) => 'turn-draft-' + w.id + '-' + id,
    ),
    ...w.notes.map((n) => 'note-draft-' + w.id + '-' + n.id),
  ];
}
