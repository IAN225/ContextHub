'use client';
import { Modal } from '../../components/shared/modal.tsx';
import { DataManager } from '../data/index.ts';
import { ImportDialog } from '../imports/index.ts';
import { UploadReview } from '../inbox/index.ts';
import { AccountPanel } from '../settings/index.ts';
import { BackgroundTaskManager } from '../tasks/index.ts';
import { TurnEditor } from '../transcript/index.ts';
import { NewWorkspace } from './new-workspace.tsx';

import type { WorkspaceController } from './use-controller.ts';
export function WorkspaceDialogs({
  controller,
}: {
  controller: WorkspaceController;
}) {
  const {
    data,
    persistence,
    cleanup,
    createWorkspace,
    modal,
    setModal,
    afterId,
    editing,
    w,
    directImports,
    candidates,
    deliveryInbox,
    updateUpload,
    importConversation,
    removeUpload,
    importUpload,
    applySummary,
    saveTurn,
  } = controller;
  return (
    <>
      {' '}
      {modal === 'turn' && (
        <TurnEditor
          key={`${w.id}-${editing?.id ?? afterId ?? 'start'}`}
          w={w}
          turn={editing}
          afterId={afterId}
          onSave={saveTurn}
          onClose={() => setModal('')}
        />
      )}{' '}
      {modal === 'new-workspace' && (
        <NewWorkspace onClose={() => setModal('')} onCreate={createWorkspace} />
      )}{' '}
      {modal === 'import' && (
        <ImportDialog
          onUpload={importConversation}
          onDeliveryEnabled={deliveryInbox.activate}
          onClose={() => setModal('')}
          pendingCount={directImports.length}
          onReview={() => setModal('review-manual')}
        />
      )}{' '}
      {(modal === 'review-manual' || modal === 'review-workbench') && (
        <Modal
          title={modal === 'review-manual' ? '确认对话导入' : '确认候选摘要'}
          description={
            modal === 'review-manual'
              ? '预览后选择工作区归档；未确认的内容可从收录对话入口继续处理。'
              : '确认后设为活跃摘要；未确认的候选会保留在当前工作区的摘要工作台。'
          }
          onClose={() => setModal('')}
        >
          <div className="upload-review-dialog">
            <UploadReview
              key={`${modal}-${w.id}`}
              uploads={modal === 'review-manual' ? directImports : candidates}
              workspaces={data.workspaces}
              currentId={w.id}
              onUpdate={updateUpload}
              onRemove={removeUpload}
              onImport={importUpload}
              onSummary={applySummary}
            />
          </div>
        </Modal>
      )}
      {modal === 'account' && (
        <Modal
          title="我的账号"
          description="管理你的登录信息和账号安全。"
          onClose={() => setModal('')}
        >
          <AccountPanel saved={persistence.saved && !persistence.busy} />
        </Modal>
      )}
      {modal === 'tasks' && (
        <BackgroundTaskManager onClose={() => setModal('')} />
      )}
      {modal === 'data' && (
        <DataManager
          state={data}
          saved={persistence.saved && !persistence.busy}
          onClose={() => setModal('')}
          onCleanup={cleanup}
        />
      )}
    </>
  );
}
