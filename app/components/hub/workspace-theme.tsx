'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { workspaceThemeClass, type WorkspaceTone } from '@/lib/workspace-theme';
const ThemeContext = createContext<WorkspaceTone | undefined>(undefined);
export function WorkspaceThemeProvider({
  tone,
  children,
}: {
  tone?: WorkspaceTone;
  children: ReactNode;
}) {
  return <ThemeContext.Provider value={tone}>{children}</ThemeContext.Provider>;
}
export function useWorkspaceThemeClass() {
  return workspaceThemeClass(useContext(ThemeContext));
}

export function WorkspaceThemeRoot({
  tone,
  children,
}: {
  tone?: WorkspaceTone;
  children: ReactNode;
}) {
  return (
    <WorkspaceThemeProvider tone={tone}>
      <div className={'journal-app ' + workspaceThemeClass(tone)}>
        {children}
      </div>
    </WorkspaceThemeProvider>
  );
}
