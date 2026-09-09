export const emptyImportDraft = {
  tab: 'manual',
  link: '',
  title: '',
  protocol: 'chat',
  json: '',
  text: '',
  format: 'auto',
};
export function normalizeImportDraft(raw: unknown): typeof emptyImportDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Invalid import draft');
  const value = raw as Record<string, unknown>;
  for (const field of Object.keys(emptyImportDraft))
    if (value[field] !== undefined && typeof value[field] !== 'string')
      throw new Error('Invalid import draft field');
  const draft = { ...emptyImportDraft, ...value } as typeof emptyImportDraft;
  if (value.text === undefined && typeof value.json === 'string')
    draft.text = value.json;
  if (!['manual', 'link', 'api'].includes(draft.tab)) draft.tab = 'manual';
  if (!['auto', 'text', 'json'].includes(draft.format)) draft.format = 'auto';
  return draft;
}
