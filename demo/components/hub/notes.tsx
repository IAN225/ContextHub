'use client';
import { useState, useEffect, useRef } from 'react';
import {
  Star,
  History,
  Trash2,
  Archive,
  RotateCcw,
  StickyNote,
  Check,
  Clock,
} from 'lucide-react';
import { usePersistent } from '@/lib/store';
import {
  Button,
  PageTitle,
  Segments,
  Modal,
  Empty,
  formatDate,
  SaveStatus,
} from './shared';
import { TextEditor } from './editors';
import { NoteActions } from './note-actions';
import { uid, now, type Workspace, type Note, type Status } from '@/lib/domain';
import type { SendWorkspaceCommand } from '@/lib/hub-state';
import type { CommitWorkspaceCommand } from '@/lib/use-hub';
import type { StorageEntry } from '@/lib/repository';
type NoteContent = { title: string; body: string; editor: string };
function NoteEditor({
  note,
  w,
  onSave,
  onStatus,
  onStar,
  focusTitle = false,
}: {
  note: Note;
  w: Workspace;
  onSave: (content: NoteContent, draft: StorageEntry) => Promise<boolean>;
  onStatus: (s: Status) => void;
  onStar: () => void;
  focusTitle?: boolean;
}) {
  const [d, setD, p] = usePersistent(`note-draft-${w.id}-${note.id}`, {
    title: note.title,
    body: note.body,
  });
  const [history, setHistory] = useState(false),
    [message, setMessage] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusTitle && p.ready) titleInput.current?.focus();
  }, [focusTitle, p.ready]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [message]);
  async function save() {
    const saved = await p.commitWith(d, (entry) =>
      onSave(
        {
          title: d.title.trim() || '无标题 Note',
          body: d.body,
          editor: '我',
        },
        entry,
      ),
    );
    if (saved) setMessage('已保存新版本');
  }
  return (
    <article className="note-paper">
      <div className="note-paper-top">
        <span className="note-id">{note.id}</span>
        <div className="action-row">
          <button
            className={`icon-button ${note.star ? 'starred' : ''}`}
            aria-label={note.star ? '取消标星' : '标星 Note'}
            onClick={onStar}
          >
            <Star size={17} fill={note.star ? 'currentColor' : 'none'} />
          </button>
          <button
            aria-label="查看历史版本"
            className="icon-button"
            onClick={() => setHistory(true)}
          >
            <History size={17} />
          </button>
          {note.status === 'normal' ? (
            <button
              aria-label="弃用 Note"
              className="icon-button"
              onClick={() => onStatus('deprecated')}
            >
              <Archive size={16} />
            </button>
          ) : (
            <button
              aria-label="恢复 Note"
              className="icon-button"
              onClick={() => onStatus('normal')}
            >
              <RotateCcw size={16} />
            </button>
          )}
          {note.status !== 'trash' && (
            <button
              aria-label="将 Note 移入回收站"
              className="icon-button"
              onClick={() => onStatus('trash')}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      <input
        ref={titleInput}
        className="note-title-input"
        aria-label="Note 标题"
        placeholder="无标题 Note"
        value={d.title}
        onChange={(e) => setD({ ...d, title: e.target.value })}
      />
      <div className="note-metadata">
        <Clock size={12} />
        {formatDate(note.updatedAt)}
        <span>·</span>
        {note.editor} 最后修改<span>·</span>
        {note.source}
      </div>
      <TextEditor
        label="NOTE · 留给未来的文字"
        value={d.body}
        onChange={(body) => setD({ ...d, body })}
        minHeight={340}
      />
      <div className="note-paper-footer">
        <span>
          <SaveStatus state={p}>
            {message || (p.saved ? '✓ 本地草稿已保存' : '正在保存草稿…')}
          </SaveStatus>
        </span>
        <Button
          primary
          disabled={!p.ready || p.busy}
          onClick={() => {
            void save();
          }}
        >
          <Check size={15} />
          保存版本
        </Button>
      </div>
      <p className="inline-note">
        {note.status === 'normal'
          ? note.star
            ? '标星 Note 优先出现在记忆包的 Note id 列表中，正文按需读取。'
            : '普通 Note 用于日记、流水账与临时记录，可搜索或按 id 读取。'
          : note.status === 'deprecated'
            ? '弃用 Note 只供用户查看，不提供给模型。'
            : `删除于 ${formatDate(note.deletedAt ?? null)}。保留 30 天后清理；可在“本地数据”中提前清空。缺少删除时间的旧记录需手动清理。`}
      </p>
      {history && (
        <Modal
          title="Note 历史版本"
          description="最多保留 5 个历史版本。恢复时会先保存当前正式版本。"
          onClose={() => setHistory(false)}
        >
          {note.versions.length ? (
            note.versions.map((v, i) => (
              <div className="version-row" key={i}>
                <div>
                  <h3>{v.title}</h3>
                  <small>{formatDate(v.time)}</small>
                  <p>{v.body.slice(0, 180)}</p>
                </div>
                <Button
                  disabled={!p.ready || p.busy}
                  onClick={async () => {
                    const restored = { title: v.title, body: v.body };
                    const saved = await p.commitWith(restored, (entry) =>
                      onSave({ ...restored, editor: '我（历史恢复）' }, entry),
                    );
                    if (saved) setHistory(false);
                  }}
                >
                  <RotateCcw size={14} />
                  恢复
                </Button>
              </div>
            ))
          ) : (
            <Empty
              title="还没有历史版本"
              detail="保存修改后，上一个版本会留在这里。"
            />
          )}
        </Modal>
      )}
    </article>
  );
}
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
  // Recover any draft from the old new-note dialog into the shared editor.
  const [oldDraft, , draft] = usePersistent(`new-note-${w.id}`, {
    title: '',
    body: '',
    star: false,
  });
  const creation = useRef(false);
  async function createNote() {
    if (creation.current || !draft.ready || draft.busy) return;
    creation.current = true;
    setCreating(true);
    setError('');
    const at = now();
    const note: Note = {
      id: `note-${uid().slice(0, 8)}`,
      title: oldDraft.title,
      body: oldDraft.body,
      star: oldDraft.star,
      status: 'normal',
      createdAt: at,
      updatedAt: at,
      editor: '我',
      source: '手动创建',
      versions: [],
    };
    try {
      const saved = await draft.commitWith(
        { title: '', body: '', star: false },
        (entry) => onCommit({ type: 'note/create', note }, entry),
      );
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
          creating={creating || !draft.ready || draft.busy}
        />
      </div>
      {draft.error && (
        <p className="error-text">
          <SaveStatus state={draft}>{null}</SaveStatus>
        </p>
      )}
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
            <p>
              标星是优先关注，
              <br />
              普通 Note 也可以被找到。
            </p>
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
                      : '还没有 Note'
            }
            detail={
              query.trim()
                ? '试试其他关键词，或清空搜索条件。'
                : filter === 'all'
                  ? '点击工具栏的笔形按钮，新建一条 Note。'
                  : '切换筛选可查看其他 Note。'
            }
          />
        )}
      </div>
    </>
  );
}
