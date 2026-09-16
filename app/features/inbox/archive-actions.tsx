'use client';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '../../components/shared/button.tsx';
import { Picker } from '../../components/shared/picker.tsx';
import { type Upload, type Workspace } from '../../lib/core/model.ts';
export function UploadArchiveActions({
  u,
  w,
  workspaces,
  target,
  onTargetChange: setTarget,
  onRestore,
  onImport,
}: {
  u: Upload;
  w: Workspace | undefined;
  workspaces: Workspace[];
  target: string;
  onTargetChange: (id: string) => void;
  onRestore: () => void;
  onImport: (u: Upload, target: string) => Promise<boolean>;
}) {
  return (
    <div className="inbox-file-action">
      {u.kind === 'summary' ? (
        <>
          <p className="inline-note">
            将替换「{w?.name ?? '来源工作区不存在'}
            」的活跃摘要，并由你选择水位是否跟随。
          </p>
          <Button
            primary
            disabled={!w || !u.summaryText?.trim()}
            onClick={onRestore}
          >
            <Check size={15} />
            设为活跃摘要
          </Button>
        </>
      ) : (
        <>
          <label className="field">
            归档到
            <Picker
              value={target}
              onChange={setTarget}
              label="归档目标"
              options={[
                ...workspaces.map((w) => ({
                  value: w.id,
                  label: `${w.name} · 原文末尾拼接`,
                })),
                { value: 'new', label: '以这份对话新建工作区' },
              ]}
            />
          </label>
          <Button
            primary
            disabled={!u.turns.length}
            onClick={() => onImport(u, target)}
          >
            <ArrowRight size={15} />
            {target === 'new' ? '新建工作区并归档' : '拼接到原文末尾'}
          </Button>
        </>
      )}
    </div>
  );
}
