'use client';
import {
  useState,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from 'react';
import { flushSync } from 'react-dom';
/** Journal view transitions and per-chapter scroll offsets are disposable UI state. */
export function useJournalNavigation(workspaces: readonly { id: string }[]) {
  const [workspaceId, setWorkspaceId] = useState(''),
    [page, setPage] = useState('archive'),
    [visitedPages, setVisitedPages] = useState(['archive']),
    [home, setHome] = useState(true),
    [openingId, setOpeningId] = useState<string | null>(null);
  const effectiveId =
    workspaces.find((w) => w.id === workspaceId)?.id ?? workspaces[0]?.id ?? '';
  const main = useRef<HTMLElement>(null);
  const opening = useRef(false);
  const chapterScroll = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    if (main.current)
      main.current.scrollTop =
        chapterScroll.current[`${effectiveId}-${page}`] ?? 0;
  }, [page, effectiveId, home]);
  const transition = useCallback((fn: () => void) => {
    const update = () => {
      flushSync(fn);
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    if (
      document.startViewTransition &&
      !window.matchMedia('(max-width: 760px), (prefers-reduced-motion: reduce)')
        .matches
    ) {
      const animation = document.startViewTransition(update);
      // A skipped snapshot must not surface as an unhandled rejection.
      void animation.ready.catch(() => {});
      void animation.finished.catch(() => {});
    } else update();
  }, []);
  useEffect(() => {
    if (!openingId) return;
    // Mount the selected archive behind the shelf while its cover lifts.
    // Match --notebook-open-duration; start after the prepared tree commits.
    const timer = setTimeout(() => {
      transition(() => {
        if (!opening.current) return;
        setHome(false);
        setOpeningId(null);
        opening.current = false;
      });
    }, 380);
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpeningId(null);
        opening.current = false;
      }
    };
    document.addEventListener('keydown', cancel);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', cancel);
    };
  }, [openingId, transition]);
  function openWorkspace(id: string) {
    if (opening.current) return;
    setWorkspaceId(id);
    setPage('archive');
    setVisitedPages(['archive']);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      transition(() => setHome(false));
    } else {
      opening.current = true;
      setOpeningId(id);
    }
  }
  function navigate(target: string) {
    if (target === page && !home) return;
    if (main.current)
      chapterScroll.current[`${effectiveId}-${page}`] = main.current.scrollTop;
    setVisitedPages((pages) =>
      pages.includes(target) ? pages : [...pages, target],
    );
    setPage(target);
    setHome(false);
  }

  return {
    workspaceId,
    setWorkspaceId,
    page,
    visitedPages,
    home,
    setHome,
    openingId,
    main,
    transition,
    openWorkspace,
    navigate,
  };
}
