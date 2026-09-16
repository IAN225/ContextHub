'use client';
import { copyText } from '@/lib/browser-compat';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function CopyButton({
  text,
  label = '复制',
  iconOnly = false,
}: {
  text: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const [state, set] = useState('');
  return (
    <button
      type="button"
      className={iconOnly ? 'copy-icon-button' : 'button'}
      aria-label={state || label}
      title={state || label}
      onClick={async () => {
        try {
          await copyText(text);
          set('已复制');
        } catch {
          set('复制失败，请手动选择');
        }
        setTimeout(() => set(''), 2500);
      }}
    >
      {state === '已复制' ? <Check size={14} /> : <Copy size={14} />}{' '}
      {!iconOnly && (state || label)}
      {iconOnly && <output className="sr-only">{state}</output>}
    </button>
  );
}
