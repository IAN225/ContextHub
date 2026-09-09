import type { Workspace, Turn, Summary, Note } from './domain.ts';

type SearchDocument = {
  id: string;
  title: string;
  text: string;
  needle: string;
};
export type MemorySearchHit = Omit<SearchDocument, 'needle'> & {
  kind: 'turn' | 'summary' | 'note';
  workspace: string;
  workspaceId: string;
};
type SearchOptions = {
  query: string;
  scope: string;
  kind: string;
  limit: number;
};

// Commands preserve unchanged source arrays. Cache each collection separately,
// so editing a memory block or starring a Note never reformats all transcripts.
// Weak keys let old collections and their text be collected after edits.
export function createMemorySearch() {
  const turns = new WeakMap<Turn[], SearchDocument[]>();
  const summaries = new WeakMap<Summary[], SearchDocument[]>();
  const notes = new WeakMap<Note[], SearchDocument[]>();
  function cached<T extends object>(
    cache: WeakMap<T, SearchDocument[]>,
    source: T,
    build: () => Omit<SearchDocument, 'needle'>[],
  ) {
    let documents = cache.get(source);
    if (!documents) {
      documents = build().map((d) => ({
        ...d,
        needle: `${d.title} ${d.text}`.toLowerCase(),
      }));
      cache.set(source, documents);
    }
    return documents;
  }
  return (workspaces: Workspace[], options: SearchOptions) => {
    const needle = options.query.trim().toLowerCase();
    const items: MemorySearchHit[] = [];
    let total = 0;
    if (!needle) return { total, items };
    for (const w of workspaces) {
      if (options.scope !== 'all' && w.id !== options.scope) continue;
      function collect(
        kind: MemorySearchHit['kind'],
        documents: SearchDocument[],
      ) {
        for (const d of documents) {
          if (!d.needle.includes(needle)) continue;
          total++;
          if (items.length < options.limit)
            items.push({
              id: d.id,
              title: d.title,
              text: d.text,
              kind,
              workspace: w.name,
              workspaceId: w.id,
            });
        }
      }
      if (options.kind === 'all' || options.kind === 'turn')
        collect(
          'turn',
          cached(turns, w.turns, () =>
            w.turns
              .filter((t) => t.status === 'normal')
              .map((t) => ({
                id: t.id,
                title: t.title,
                text: t.messages
                  .map((m) => `${m.role}: ${m.content}`)
                  .join('\n\n'),
              })),
          ),
        );
      if (options.kind === 'all' || options.kind === 'summary')
        collect(
          'summary',
          cached(summaries, w.summaries, () =>
            w.summaries.map((s) => ({
              id: s.id,
              title: s.title,
              text: s.text,
            })),
          ),
        );
      if (options.kind === 'all' || options.kind === 'note')
        collect(
          'note',
          cached(notes, w.notes, () =>
            w.notes
              .filter((n) => n.status === 'normal')
              .map((n) => ({ id: n.id, title: n.title, text: n.body })),
          ),
        );
    }
    return { total, items };
  };
}
