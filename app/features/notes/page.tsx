'use client';
import { Star, StickyNote } from 'lucide-react';
import { useRef, useState } from 'react';
import { Empty } from '../../components/shared/empty.tsx';
import { PageTitle } from '../../components/shared/page-title.tsx';
import { Segments } from '../../components/shared/segments.tsx';
import { now, uid } from '../../lib/core/identity.ts';
import { type Note, type Workspace } from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import { type SendWorkspaceCommand } from '../../lib/state/contracts.ts';
import type { CommitWorkspaceCommand } from '../../lib/application/use-hub.ts';
import { NoteActions } from './actions.tsx';
import { NoteEditor } from './editor.tsx';
export function NotesPage({
  w,
  onCommand,
  onCommit,
}: {
  w: Workspace;
  onCommand: SendWorkspaceCommand;
  onCommit: CommitWorkspaceCommand;
}) {
  const [id, setId] = useState(w.notes[0]?.id),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [freshId, setFreshId] = useState<string>(),
    [creating, setCreating] = useState(false),
    [error, setError] = useState('');
  const creation = useRef(false);
  async function createNote() {
    if (creation.current) return;
    creation.current = true;
    setCreating(true);
    setError('');
    const at = now();
    const note: Note = {
      id: `note-${uid().slice(0, 8)}`,
      title: '',
      body: '',
      star: false,
      status: 'normal',
      createdAt: at,
      updatedAt: at,
      editor: '我',
      source: '手动创建',
      versions: [],
    };
    try {
      const saved = await onCommit({ type: 'note/create', note });
      if (!saved) {
        setError('新笔记未能保存，请重试。');
        return;
      }
      setFilter('all');
      setQuery('');
      setId(note.id);
      setFreshId(note.id);
    } finally {
      creation.current = false;
      setCreating(false);
    }
  }
  const scopedNotes = w.notes.filter((n) =>
    filter === 'star'
      ? n.status === 'normal' && n.star
      : filter === 'all'
        ? n.status === 'normal'
        : n.status === filter,
  );
  const matching = (value: string) =>
    scopedNotes.filter((n) =>
      `${n.title} ${n.body}`.toLowerCase().includes(value.toLowerCase()),
    );
  const list = matching(query);
  function search(value: string) {
    const matches = matching(value);
    setId((previous) =>
      matches.some((n) => n.id === previous) ? previous : matches[0]?.id,
    );
    setQuery(value);
  }
  const selected = list.find((n) => n.id === id) ?? list[0];
  return (
    <>
      <div className="section-heading compact">
        <div>
          <PageTitle>Note</PageTitle>
        </div>
      </div>
      <div className="notes-toolbar">
        <Segments
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: '全部 Note' },
            { id: 'star', label: '标星' },
            { id: 'deprecated', label: '弃用' },
            { id: 'trash', label: '回收站' },
          ]}
        />
        <NoteActions
          query={query}
          onQueryChange={search}
          onCreate={() => {
            void createNote();
          }}
          creating={creating}
        />
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="notes-layout">
        <aside className="note-list">
          {list.map((n) => (
            <button
              key={n.id}
              className={selected?.id === n.id ? 'selected' : ''}
              onClick={() => setId(n.id)}
            >
              <div>
                <h3>{n.title || '无标题 Note'}</h3>
                {n.star && <Star size={13} fill="currentColor" />}
              </div>
              <p>{n.body.slice(0, 80)}</p>
              <small>
                {formatDate(n.updatedAt)}
                <span>{n.source}</span>
              </small>
            </button>
          ))}
          {!list.length && <p className="inline-note">当前列表为空。</p>}
          <div className="note-list-help">
            <StickyNote size={16} />
            <p>模型预览 Note 列表时，标★的文档额外展示一部分正文。</p>
          </div>
        </aside>
        {selected ? (
          <NoteEditor
            key={selected.id}
            note={selected}
            focusTitle={selected.id === freshId}
            w={w}
            onSave={(content, entry) =>
              onCommit(
                {
                  type: 'note/save',
                  noteId: selected.id,
                  ...content,
                  at: now(),
                },
                entry,
              )
            }
            onStar={() =>
              onCommand({ type: 'note/star', noteId: selected.id, at: now() })
            }
            onStatus={(status) =>
              onCommand({
                type: 'note/status',
                noteId: selected.id,
                status,
                at: now(),
              })
            }
          />
        ) : (
          <article className="note-paper note-empty-paper">
            <Empty
              title={
                query.trim()
                  ? '没有找到匹配的 Note'
                  : filter === 'star'
                    ? '暂无标星 Note'
                    : filter === 'deprecated'
                      ? '暂无弃用 Note'
                      : filter === 'trash'
                        ? '回收站为空'
                        : '暂无 Note'
              }
              detail={query.trim() ? '试试其他关键词，或清空搜索条件。' : ''}
            />
          </article>
        )}
      </div>
    </>
  );
}
