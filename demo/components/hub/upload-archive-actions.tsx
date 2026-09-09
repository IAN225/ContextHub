'use client';
import { Check, ArrowRight } from 'lucide-react';
import { Button, Picker } from './shared';
import type { Upload, Workspace } from '@/lib/domain';
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
            将替换「{w?.name ?? '来源手账不存在'}
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
            收进哪一本
            <Picker
              value={target}
              onChange={setTarget}
              label="归档目标"
              options={[
                ...workspaces.map((w) => ({
                  value: w.id,
                  label: `${w.name} · 原文末尾拼接`,
                })),
                { value: 'new', label: '以这份对话新建一本手账' },
              ]}
            />
          </label>
          <Button
            primary
            disabled={!u.turns.length}
            onClick={() => onImport(u, target)}
          >
            <ArrowRight size={15} />
            {target === 'new' ? '新建手账并归档' : '拼接到原文末尾'}
          </Button>
        </>
      )}
    </div>
  );
}
