import {
  Archive,
  Check,
  Clock,
  History,
  RotateCcw,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/shared/button.tsx';
import { CopyButton } from '../../components/shared/copy-button.tsx';
import { Empty } from '../../components/shared/empty.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import {
  DraftBoundary,
  SaveStatus,
} from '../../components/shared/persistence-status.tsx';
import { TextEditor } from '../../components/shared/text-editor.tsx';
import {
  type Note,
  type Status,
  type Workspace,
} from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import type { StorageEntry } from '../../lib/storage/account-repository.ts';
import { usePersistent } from '../../lib/storage/use-persistent.ts';
export type NoteContent = { title: string; body: string; editor: string };
export function NoteEditor({
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
  const [d, setD, p] = usePersistent<{
    title: string;
    body: string;
    baseTitle?: string;
    baseBody?: string;
  }>(`note-draft-${w.id}-${note.id}`, {
    title: note.title,
    body: note.body,
    baseTitle: note.title,
    baseBody: note.body,
  });
  const newerVersion =
    d.baseTitle !== undefined &&
    (d.baseTitle !== note.title || d.baseBody !== note.body);
  useEffect(() => {
    if (!p.ready) return;
    if (d.baseTitle === undefined) {
      setD({ ...d, baseTitle: note.title, baseBody: note.body });
    } else if (
      newerVersion &&
      ((d.title === d.baseTitle && d.body === d.baseBody) ||
        (d.title === note.title && d.body === note.body))
    ) {
      setD({
        title: note.title,
        body: note.body,
        baseTitle: note.title,
        baseBody: note.body,
      });
    }
  }, [p.ready, d, note.title, note.body, newerVersion, setD]);
  const [history, setHistory] = useState(false),
    [message, setMessage] = useState('');
  const titleInput = useRef<HTMLInputElement>(null);
  const created = new Date(note.createdAt);
  useEffect(() => {
    if (focusTitle && p.ready) titleInput.current?.focus();
  }, [focusTitle, p.ready]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 2000);
    return () => clearTimeout(timer);
  }, [message]);
  async function save() {
    if (newerVersion) {
      setMessage('正文已更新，请先核对新版本。');
      return;
    }
    const content = { title: d.title.trim() || '无标题 Note', body: d.body };
    const saved = await p.commitWith(
      { ...content, baseTitle: content.title, baseBody: content.body },
      (entry) =>
        onSave(
          {
            ...content,
            editor: '我',
          },
          entry,
        ),
    );
    if (saved) setMessage('已保存新版本');
  }
  return (
    <DraftBoundary state={p}>
      <article className="note-paper">
        <div className="note-paper-top">
          <span className="note-created" title="创建日期">
            CREATED ·{' '}
            {Number.isFinite(created.getTime())
              ? created
                  .toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })
                  .replaceAll('/', '.')
              : '日期未知'}
          </span>
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
          label={`NOTE · ${note.id}`}
          labelAction={<CopyButton text={note.id} label="复制 ID" iconOnly />}
          value={d.body}
          onChange={(body) => setD({ ...d, body })}
          minHeight={340}
        />
        {(newerVersion && d.title !== note.title) ||
        (newerVersion && d.body !== note.body) ? (
          <p className="callout warning">
            Note
            已有新版本，当前草稿仍保留。保存会另建版本，已有内容可在历史中查看。
            <Button
              onClick={() =>
                setD({
                  title: note.title,
                  body: note.body,
                  baseTitle: note.title,
                  baseBody: note.body,
                })
              }
            >
              载入最新版本
            </Button>
          </p>
        ) : null}
        <div className="note-paper-footer">
          <span>
            <SaveStatus state={p}>
              {message || (p.saved ? '✓ 草稿已保存' : '正在保存草稿…')}
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
              : `删除于 ${formatDate(note.deletedAt ?? null)}。保留 30 天后清理；可在数据与备份中提前清空。缺少删除时间的旧记录需手动清理。`}
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
                        onSave(
                          { ...restored, editor: '我（历史恢复）' },
                          entry,
                        ),
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
    </DraftBoundary>
  );
}
