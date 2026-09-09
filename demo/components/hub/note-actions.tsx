'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { Pencil, Search, X } from 'lucide-react';

export function NoteActions({
  query,
  onQueryChange,
  onCreate,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const search = useRef<HTMLButtonElement>(null);
  const pointerOutside = useRef(false);
  const inputId = useId();
  const close = useCallback(
    (returnFocus = false) => {
      setOpen(false);
      onQueryChange('');
      input.current?.blur();
      if (returnFocus) search.current?.focus({ preventScroll: true });
    },
    [onQueryChange],
  );
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) =>
      !root.current?.contains(event.target as Node);
    const pointerDown = (event: PointerEvent) => {
      pointerOutside.current = outside(event);
    };
    const click = (event: MouseEvent) => {
      // Close after the clicked Note's own handler, so clearing the filter
      // cannot move list items under the pointer before selection completes.
      if (outside(event)) close();
      pointerOutside.current = false;
    };
    const resetPointer = () => {
      pointerOutside.current = false;
    };
    document.addEventListener('pointerdown', pointerDown, true);
    document.addEventListener('click', click);
    document.addEventListener('pointercancel', resetPointer);
    document.addEventListener('keydown', resetPointer, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true);
      document.removeEventListener('click', click);
      document.removeEventListener('pointercancel', resetPointer);
      document.removeEventListener('keydown', resetPointer, true);
    };
  }, [open, close]);
  return (
    <div
      ref={root}
      className="note-actions"
      data-search-open={open}
      onBlur={(event) => {
        if (
          open &&
          !pointerOutside.current &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          close();
      }}
    >
      <div className="note-actions-capsule">
        <button
          className="note-compose"
          aria-label="新建 Note"
          title="新建 Note"
          disabled={open}
          onClick={onCreate}
        >
          <Pencil size={17} />
        </button>
        <button
          ref={search}
          className="note-search-toggle"
          aria-label="搜索 Note"
          aria-controls={inputId}
          aria-expanded={open}
          title="搜索 Note"
          onKeyDown={escape}
          onClick={() => {
            // Keep focus in the activation gesture so mobile keyboards open.
            flushSync(() => setOpen(true));
            input.current?.focus({ preventScroll: true });
          }}
        >
          <Search size={17} />
        </button>
        <div className="note-search-field" inert={!open} aria-hidden={!open}>
          <input
            id={inputId}
            ref={input}
            type="search"
            aria-label="搜索 Note 内容"
            placeholder="搜索 Note…"
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            tabIndex={open ? 0 : -1}
            onKeyDown={escape}
          />
          {query && (
            <button
              className="note-search-clear"
              aria-label="清空搜索"
              onKeyDown={escape}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                onQueryChange('');
                input.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
