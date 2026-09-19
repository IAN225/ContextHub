'use client';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { HubState } from '../state/contracts';
import { createTaskSession } from './session';
export function useBackgroundTasks(data: HubState, enabled: boolean) {
  const [session] = useState(createTaskSession);
  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getServerSnapshot,
  );
  useLayoutEffect(() => {
    session.setData(data);
  }, [data, session]);
  useEffect(() => {
    session.setEnabled(enabled);
    if (!enabled) return;
    let disposed = false,
      busy = false;
    const poll = async () => {
      if (disposed || busy) return;
      busy = true;
      try {
        await session.refresh();
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, 1500);
    window.addEventListener('focus', poll);
    return () => {
      disposed = true;
      session.setEnabled(false);
      clearInterval(timer);
      window.removeEventListener('focus', poll);
    };
  }, [enabled, session]);
  return {
    ...state,
    problems: Object.fromEntries(
      state.tasks.filter((t) => t.error).map((t) => [t.id, t.error!]),
    ),
    startSummary: session.startSummary,
    startAttachment: session.startAttachment,
    startWorkbench: session.startWorkbench,
    control: session.control,
    refresh: session.refresh,
    refreshTask: session.refreshTask,
  };
}
export type BackgroundTasks = ReturnType<typeof useBackgroundTasks>;
export const BackgroundTasksContext = createContext<BackgroundTasks | null>(
  null,
);
export function useTaskQueue() {
  return useContext(BackgroundTasksContext);
}
