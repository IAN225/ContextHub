'use client';
import { ClipboardPaste } from 'lucide-react';
import { Button, Picker } from '../shared';
import { TextEditor } from '../editors';

export function ManualImport({
  text,
  format,
  onText,
  onFormat,
  onSubmit,
  disabled,
}: {
  text: string;
  format: string;
  onText: (text: string) => void;
  onFormat: (format: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <div className="form-stack">
      <label className="field">
        内容格式
        <Picker
          label="复制内容格式"
          value={format}
          onChange={onFormat}
          options={[
            { value: 'auto', label: '自动识别' },
            { value: 'text', label: '对话文本' },
            { value: 'json', label: '请求 JSON / 消息数组' },
          ]}
        />
      </label>
      <p className="inline-note">
        粘贴对话正文或请求
        JSON。多轮文本用“用户：”和“助手：”分隔，代码块会保持原样。
      </p>
      <TextEditor
        label="复制的对话"
        value={text}
        onChange={onText}
        minHeight={240}
      />
      <Button primary disabled={disabled || !text.trim()} onClick={onSubmit}>
        <ClipboardPaste size={15} />
        预览导入
      </Button>
    </div>
  );
}
