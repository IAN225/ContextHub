'use client';
import { Bold, Code2, Eye, List, Paperclip, Type } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Markdown } from './markdown.tsx';

export function TextEditor({
  value,
  onChange,
  label,
  minHeight = 160,
  onFiles,
  labelAction,
}: {
  value: string;
  onChange: (s: string) => void;
  label: string;
  minHeight?: number;
  onFiles?: (files: File[]) => void;
  labelAction?: ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null),
    [preview, setPreview] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  function wrap(before: string, after = '') {
    const e = ref.current;
    if (!e) return;
    const start = e.selectionStart,
      end = e.selectionEnd;
    onChange(
      value.slice(0, start) +
        before +
        value.slice(start, end) +
        after +
        value.slice(end),
    );
    requestAnimationFrame(() => {
      e.focus();
      e.setSelectionRange(start + before.length, end + before.length);
    });
  }
  return (
    <div className="rich-editor">
      <div className="editor-toolbar">
        {labelAction ? (
          <div className="editor-label">
            <span>{label}</span>
            {labelAction}
          </div>
        ) : (
          <span>{label}</span>
        )}
        <div>
          <button
            aria-label="加粗"
            title="加粗"
            disabled={preview}
            onClick={() => wrap('**', '**')}
          >
            <Bold size={14} />
          </button>
          <button
            aria-label="添加列表"
            disabled={preview}
            onClick={() => wrap('\n- ')}
          >
            <List size={15} />
          </button>
          <button
            aria-label="添加代码"
            disabled={preview}
            onClick={() => wrap('\n```\n', '\n```')}
          >
            <Code2 size={15} />
          </button>
          {onFiles && (
            <>
              <button
                aria-label="添加图片或附件"
                onClick={() => file.current?.click()}
              >
                <Paperclip size={15} />
              </button>
              <input
                hidden
                ref={file}
                type="file"
                multiple
                onChange={(e) => {
                  onFiles(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button
            aria-label={preview ? '编辑文本' : '预览 Markdown'}
            className={preview ? 'mint' : ''}
            onClick={() => setPreview(!preview)}
          >
            {preview ? <Type size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="editor-preview" style={{ minHeight }}>
          <Markdown text={value || '尚无内容'} />
        </div>
      ) : (
        <textarea
          ref={ref}
          aria-label={label}
          style={{ minHeight }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length && onFiles) {
              e.preventDefault();
              onFiles(files);
            }
          }}
          placeholder="粘贴或写下原文…支持 Markdown、图片粘贴与附件"
        />
      )}
    </div>
  );
}
