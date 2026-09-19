'use client';
import { ConnectionsPage } from '../connections/index.ts';
import { InboxPage } from '../inbox/index.ts';
import { MemoryPage } from '../memory/index.ts';
import { NotesPage } from '../notes/index.ts';
import { SearchPage } from '../search/index.ts';
import { SummaryPage } from '../summary/index.ts';
import { Transcript } from '../transcript/index.ts';
import { WorkspaceSettings } from './settings.tsx';

import type { WorkspaceController } from './use-controller.ts';
export function WorkspacePanels({
  controller,
}: {
  controller: WorkspaceController;
}) {
  const {
    data,
    refresh,
    persistence,
    dispatch,
    deleteWorkspace,
    page,
    visitedPages,
    home,
    setModal,
    w,
    onWorkspaceCommand,
    commitWorkspace,
    deliveries,
    noteNotifications,
    candidates,
    deliveryInbox,
    background,
    mcp,
    updateUpload,
    removeUpload,
    importUpload,
    applySummary,
    edit,
    insert,
  } = controller;
  return (
    <>
      {visitedPages
        .filter(
          (panel) =>
            data.workspaces.length > 0 || ['inbox', 'search'].includes(panel),
        )
        .map((panel) => (
          <div
            key={panel}
            className={`chapter-panel${panel === 'inbox' ? ' inbox-chapter' : ''}`}
            hidden={page !== panel}
          >
            {panel === 'archive' ? (
              <Transcript
                w={w}
                active={!home && page === 'archive'}
                onCommand={onWorkspaceCommand}
                onInsert={insert}
                onEdit={edit}
              />
            ) : panel === 'summary' ? (
              <SummaryPage
                w={w}
                onRefresh={refresh}
                onCommand={onWorkspaceCommand}
                onCommit={commitWorkspace}
                pendingCount={candidates.length}
                onReview={() => setModal('review-workbench')}
              />
            ) : panel === 'notes' ? (
              <NotesPage
                w={w}
                onCommand={onWorkspaceCommand}
                onCommit={commitWorkspace}
              />
            ) : panel === 'memory' ? (
              <MemoryPage w={w} onCommand={onWorkspaceCommand} />
            ) : panel === 'inbox' ? (
              <>
                {deliveryInbox.error && (
                  <p role="alert" className="callout warning">
                    {deliveryInbox.error}
                  </p>
                )}
                <InboxPage
                  notifications={noteNotifications}
                  onRead={(id) =>
                    dispatch({
                      type: 'notification/read',
                      notificationId: id,
                    })
                  }
                  uploads={deliveries}
                  workspaces={data.workspaces}
                  currentId={w.id}
                  onUpdate={updateUpload}
                  onRemove={removeUpload}
                  onImport={importUpload}
                  onSummary={applySummary}
                />
              </>
            ) : panel === 'settings' ? (
              <WorkspaceSettings
                w={w}
                onCommit={commitWorkspace}
                ready={background.ready && persistence.saved}
                onDelete={deleteWorkspace}
              />
            ) : panel === 'connect' ? (
              <ConnectionsPage
                w={w}
                active={!home && page === 'connect'}
                mcp={mcp}
              />
            ) : (
              <SearchPage workspaces={data.workspaces} currentId={w.id} />
            )}
          </div>
        ))}
    </>
  );
}
