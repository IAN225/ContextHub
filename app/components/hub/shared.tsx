'use client';
import { copyText } from '@/lib/browser-compat';
import { Check, Copy, X, MessageSquare } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
export function PageTitle({ children }: { children: ReactNode }) {
  return <h1>{children}</h1>;
}
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`button ${primary ? 'primary' : ''} ${className}`}
    >
      {children}
    </button>
  );
}
export function SaveStatus({
  state,
  children,
}: {
  state: { ready: boolean; error: string; retry: () => Promise<void> };
  children: ReactNode;
}) {
  if (!state.error) return <>{children}</>;
  return (
    <span role="alert">
      {state.error}{' '}
      <button
        type="button"
        className="text-button"
        onClick={() => {
          void state.retry();
        }}
      >
        {state.ready ? '重试保存' : '重试读取'}
      </button>
    </span>
  );
}
export function DraftBoundary({
  state,
  children,
}: {
  state: { ready: boolean; error: string; retry: () => Promise<void> };
  children: ReactNode;
}) {
  if (state.ready) return <>{children}</>;
  return (
    <output className="muted" aria-busy={!state.error}>
      <SaveStatus state={state}>正在读取草稿…</SaveStatus>
    </output>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (!open && details.reason !== 'outside-press') onClose();
      }}
    >
      <DialogContent className="hub-dialog" showCloseButton={false}>
        <div className="dialog-heading">
          <div>
            <DialogTitle className="dialog-title">{title}</DialogTitle>
            <DialogDescription className={description ? undefined : 'sr-only'}>
              {description ?? title}
            </DialogDescription>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Segments({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(String(v))}>
      <TabsList className="segments">
        {options.map((o) => (
          <TabsTrigger key={o.id} value={o.id}>
            {o.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
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
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {text.split(/(```[\s\S]*?```)/g).map((section, sectionIndex) =>
        section.startsWith('```') ? (
          <pre key={sectionIndex}>
            {section.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}
          </pre>
        ) : (
          <div key={sectionIndex}>
            {section.split('\n').map((line, i) => {
              if (!line) return <div className="paragraph-space" key={i} />;
              const heading = line.match(/^(#{1,3})\s+(.*)/);
              const parts = (heading ? heading[2] : line.replace(/^[-*] /, ''))
                .split(/(\*\*.*?\*\*)/)
                .map((p, j) =>
                  p.startsWith('**') ? (
                    <strong key={j}>{p.slice(2, -2)}</strong>
                  ) : (
                    p
                  ),
                );
              return heading ? (
                <h3 key={i}>{parts}</h3>
              ) : (
                <p className={/^[-*] /.test(line) ? 'list-line' : ''} key={i}>
                  {parts}
                </p>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}
export { ChainMap } from './coverage-map';
export { Composer, blockLabels } from './prompt-composer';
export function Empty({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <MessageSquare size={32} />
      <h3>{title}</h3>
      <p>{detail}</p>
      {children}
    </div>
  );
}
export function formatDate(v: string | null) {
  return v
    ? new Date(v).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '时间未知';
}
export function Picker({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      items={options}
    >
      <SelectTrigger className="hub-select" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
