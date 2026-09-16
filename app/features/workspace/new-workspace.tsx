'use client';
import type { StorageEntry } from '@/lib/repository';
import { usePersistent } from '@/lib/store';
import { Plus } from 'lucide-react';
import { Button } from '../../components/shared/button.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import { DraftBoundary } from '../../components/shared/persistence-status.tsx';
import { Picker } from '../../components/shared/picker.tsx';

export function NewWorkspace({
  onCreate,
  onClose,
}: {
  onCreate: (
    name: string,
    platform: string,
    draft: StorageEntry,
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [d, setD, p] = usePersistent('new-workspace-draft', {
    name: '',
    platform: 'ChatGPT',
  });
  return (
    <Modal
      title="新建工作区"
      onClose={() => {
        if (!p.busy) onClose();
      }}
    >
      <DraftBoundary state={p}>
        <label className="field">
          工作区名称
          <input
            value={d.name}
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="工作区名称"
          />
        </label>
        <label className="field">
          来源平台
          <Picker
            value={d.platform}
            label="新工作区平台"
            options={['ChatGPT', 'Claude', 'Chatbox', '其他'].map((v) => ({
              value: v,
              label: v,
            }))}
            onChange={(platform) => setD({ ...d, platform })}
          />
        </label>
        <div className="form-actions">
          <span className="save-caption">
            {p.error || (p.saved ? '✓ 草稿已保存' : '保存中…')}
            {p.error && (
              <button
                className="text-button"
                onClick={() => {
                  void p.retry();
                }}
              >
                {p.ready ? '重试保存' : '重试读取'}
              </button>
            )}
          </span>
          <Button
            primary
            disabled={!d.name.trim() || !p.ready || p.busy}
            onClick={async () => {
              await p.commitWith({ name: '', platform: 'ChatGPT' }, (entry) =>
                onCreate(d.name.trim(), d.platform, entry),
              );
            }}
          >
            <Plus size={15} />
            创建
          </Button>
        </div>
      </DraftBoundary>
    </Modal>
  );
}
