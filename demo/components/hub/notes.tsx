'use client';
import { useState } from 'react';
import {
  Plus,
  Star,
  History,
  Trash2,
  Archive,
  RotateCcw,
  StickyNote,
  Check,
  Clock,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { usePersistent } from '@/lib/store';
import {
  Button,
  PageTitle,
  Segments,
  Modal,
  Empty,
  formatDate,
} from './shared';
import { TextEditor } from './editors';
import { NoteActions } from './note-actions';
import { uid, now, type Workspace, type Note, type Status } from '@/lib/domain';
function NoteEditor({
  note,
  w,
  onSave,
  onStatus,
  onStar,
}: {
  note: Note;
  w: Workspace;
  onSave: (n: Note) => void;
  onStatus: (s: Status) => void;
  onStar: () => void;
}) {
  const [d, setD, p] = usePersistent(`note-draft-${w.id}-${note.id}`, {
    title: note.title,
    body: note.body,
  });
  const [history, setHistory] = useState(false),
    [message, setMessage] = useState('');
  function save() {
    const next = {
      ...note,
      title: d.title.trim() || '无标题 Note',
      body: d.body,
      updatedAt: now(),
      editor: '我',
      versions: [
        { title: note.title, body: note.body, time: note.updatedAt },
        ...note.versions,
      ].slice(0, 5),
    };
    onSave(next);
    setMessage('已保存新版本');
    setTimeout(() => setMessage(''), 2000);
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
        className="note-title-input"
        aria-label="Note 标题"
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
          {p.error ||
            message ||
            (p.saved ? '✓ 本地草稿已保存' : '正在保存草稿…')}
        </span>
        <Button primary disabled={!p.ready} onClick={save}>
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
            : `删除于 ${formatDate(note.deletedAt ?? null)}。正式版 30 天后清除；本地 demo 不自动清理。`}
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
                  onClick={() => {
                    const next = {
                      ...note,
                      title: v.title,
                      body: v.body,
                      updatedAt: now(),
                      editor: '我（历史恢复）',
                      versions: [
                        {
                          title: note.title,
                          body: note.body,
                          time: note.updatedAt,
                        },
                        ...note.versions,
                      ].slice(0, 5),
                    };
                    onSave(next);
                    setD({ title: v.title, body: v.body });
                    setHistory(false);
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
function NewNote({
  w,
  onCreate,
  onClose,
}: {
  w: Workspace;
  onCreate: (n: Note) => void;
  onClose: () => void;
}) {
  const [d, setD, p] = usePersistent(`new-note-${w.id}`, {
    title: '',
    body: '',
    star: false,
  });
  return (
    <Modal
      title="新建 Note"
      description="不用把一切都藏在历史里。把希望再次被找到的内容，单独留下来。"
      onClose={onClose}
    >
      <label className="field">
        标题
        <input
          value={d.title}
          onChange={(e) => setD({ ...d, title: e.target.value })}
          placeholder="给这段文字一个名字"
        />
      </label>
      <TextEditor
        value={d.body}
        onChange={(body) => setD({ ...d, body })}
        label="正文"
        minHeight={240}
      />
      <label className="checks">
        <Switch
          checked={d.star}
          onCheckedChange={(star) => setD({ ...d, star })}
        />
        <span>标星 · 希望模型长期优先关注</span>
      </label>
      <div className="form-actions">
        <span className="save-caption">
          {p.error || (p.saved ? '✓ 草稿已保存' : '正在保存…')}
        </span>
        <Button onClick={onClose}>保留草稿</Button>
        <Button
          primary
          disabled={!p.ready || !d.body.trim()}
          onClick={async () => {
            if (!(await p.commit({ title: '', body: '', star: false }))) return;
            onCreate({
              id: `note-${uid().slice(0, 8)}`,
              title: d.title.trim() || '无标题 Note',
              body: d.body,
              star: d.star,
              status: 'normal',
              createdAt: now(),
              updatedAt: now(),
              editor: '我',
              source: '手动创建',
              versions: [],
            });
          }}
        >
          <Plus size={15} />
          创建 Note
        </Button>
      </div>
    </Modal>
  );
}
export function NotesPage({
  w,
  onChange,
}: {
  w: Workspace;
  onChange: (w: Workspace) => void;
}) {
  const [id, setId] = useState(w.notes[0]?.id),
    [filter, setFilter] = useState('all'),
    [query, setQuery] = useState(''),
    [create, setCreate] = useState(false);
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
  function update(n: Note) {
    onChange({ ...w, notes: w.notes.map((x) => (x.id === n.id ? n : x)) });
  }
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
          onCreate={() => setCreate(true)}
        />
      </div>
      <div className="notes-layout">
        <aside className="note-list">
          {list.map((n) => (
            <button
              key={n.id}
              className={selected?.id === n.id ? 'selected' : ''}
              onClick={() => setId(n.id)}
            >
              <div>
                <h3>{n.title}</h3>
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
            w={w}
            onSave={update}
            onStar={() =>
              update({ ...selected, star: !selected.star, updatedAt: now() })
            }
            onStatus={(status) =>
              update({
                ...selected,
                status,
                deletedAt: status === 'trash' ? now() : undefined,
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
      {create && (
        <NewNote
          w={w}
          onClose={() => setCreate(false)}
          onCreate={(n) => {
            onChange({ ...w, notes: [n, ...w.notes] });
            setId(n.id);
            setFilter('all');
            setCreate(false);
          }}
        />
      )}
    </>
  );
}
