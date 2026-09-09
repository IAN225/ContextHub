'use client';
import { useState } from 'react';
import { Plus, Minus, Trash2 } from 'lucide-react';
import { Button, Modal } from './shared';
import {
  coverage,
  memoryText,
  memoryNotes,
  memoryBlockLabel,
  type Block,
  type Workspace,
} from '@/lib/domain';
export function MemoryBlockEditor({
  w,
  block,
  onUpdate: update,
  onRemove,
  onClose,
}: {
  w: Workspace;
  block: Block;
  onUpdate: (patch: Partial<Block>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  return (
    <Modal
      title={memoryBlockLabel(block)}
      description="修改即时保存到此记忆包，不会改动源内容。删除后重新添加可恢复动态引用。"
      onClose={onClose}
    >
      <div className="memory-block-editor">
        {(block.type === 'summary' || block.type === 'text') && (
          <label>
            {block.type === 'summary' ? '摘要内容' : '文本内容'}
            <textarea
              aria-label={block.type === 'summary' ? '摘要内容' : '文本内容'}
              rows={12}
              value={
                block.type === 'summary' && !block.custom
                  ? (coverage(w).active?.text ?? '')
                  : (block.text ?? '')
              }
              onChange={(e) =>
                update({
                  text: e.target.value,
                  ...(block.type === 'summary' ? { custom: true } : {}),
                })
              }
            />
          </label>
        )}
        {block.type === 'recent' && (
          <>
            <label>
              完整原文轮数
              <input
                type="number"
                min={0}
                max={w.turns.length}
                aria-label="自选窗口轮数"
                value={block.custom ? (block.windowLength ?? 0) : w.retain}
                onChange={(e) =>
                  update({
                    custom: true,
                    windowLength: Math.max(
                      0,
                      Math.min(
                        w.turns.length,
                        Math.floor(Number(e.target.value) || 0),
                      ),
                    ),
                  })
                }
              />
            </label>
            <p className="field-help">
              沿用当前处理水位后的起点，只调整这份记忆包携带的完整轮数。
            </p>
            <pre className="memory-editor-preview">
              {memoryText(w, [block])}
            </pre>
          </>
        )}
        {block.type === 'stars' && (
          <>
            <input
              aria-label="查找 Note id 或标题"
              placeholder="查找 Note id 或标题"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="memory-note-options">
              {w.notes
                .filter(
                  (n) =>
                    n.status === 'normal' &&
                    `${n.id} ${n.title}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((n) => {
                  const selected = memoryNotes(w, block).some(
                    (x) => x.id === n.id,
                  );
                  return (
                    <button
                      key={n.id}
                      aria-pressed={selected}
                      aria-label={`${selected ? '移除' : '添加'} Note ${n.id}`}
                      onClick={() => {
                        const ids = memoryNotes(w, block).map((x) => x.id);
                        update({
                          custom: true,
                          noteIds: selected
                            ? ids.filter((id) => id !== n.id)
                            : [...ids, n.id],
                        });
                      }}
                    >
                      <span>
                        <strong>{n.title}</strong>
                        <small>{n.id}</small>
                      </span>
                      {selected ? <Minus size={17} /> : <Plus size={17} />}
                    </button>
                  );
                })}
            </div>
            <p className="field-help">
              已选择 {memoryNotes(w, block).length} 条。仅发送 id
              与标题，正文仍按 id 单独读取。
            </p>
          </>
        )}
      </div>
      <div className="memory-editor-actions">
        <button className="text-button danger" onClick={onRemove}>
          <Trash2 size={15} />
          删除组件
        </button>
        <Button onClick={onClose}>完成</Button>
      </div>
    </Modal>
  );
}
