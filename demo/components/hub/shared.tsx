'use client';
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
import type { Workspace } from '@/lib/domain';
import { coverage } from '@/lib/domain';
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
            <DialogDescription>
              {description ?? '修改自动保存为本地草稿，点击外部不会关闭。'}
            </DialogDescription>
          </div>
          <button
            aria-label="关闭，保留草稿"
            className="icon-button"
            onClick={onClose}
          >
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
}: {
  text: string;
  label?: string;
}) {
  const [state, set] = useState('');
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          set('已复制');
        } catch {
          set('复制失败，请手动选择');
        }
        setTimeout(() => set(''), 2500);
      }}
    >
      {state === '已复制' ? <Check size={14} /> : <Copy size={14} />}{' '}
      {state || label}
    </Button>
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
export function ChainMap({
  w,
  selectedTurnId,
  includeInactive = false,
}: {
  w: Workspace;
  selectedTurnId?: string;
  includeInactive?: boolean;
}) {
  const c = coverage(w);
  const turns = includeInactive
    ? w.turns
    : w.turns.filter((t) => t.status === 'normal');
  const n = Math.max(1, turns.length);
  const selectedIndex = turns.findIndex((t) => t.id === selectedTurnId);
  const selectedNumber = w.turns.findIndex((t) => t.id === selectedTurnId) + 1;
  const inactiveCount = turns.filter((t) => t.status !== 'normal').length;
  const recent = new Set(c.recent.map((t) => t.id)),
    cov = new Set(c.covered.map((t) => t.id)),
    gap = new Set(c.gap.map((t) => t.id));
  const runs: { type: string; count: number; start: number }[] = [];
  turns.forEach((t, i) => {
    const type =
      t.status !== 'normal'
        ? t.status
        : recent.has(t.id)
          ? 'recent'
          : gap.has(t.id)
            ? 'gap'
            : cov.has(t.id)
              ? 'covered'
              : 'pending';
    if (runs.at(-1)?.type === type) runs[runs.length - 1].count++;
    else runs.push({ type, count: 1, start: i });
  });
  return (
    <div className={`chain${includeInactive ? ' chain-positioned' : ''}`}>
      <div className="chain-track">
        {runs.map((r, i) => (
          <div
            key={i}
            style={{ flex: r.count / n, minWidth: r.count ? 6 : 0 }}
            className={`chain-run ${r.type}`}
            title={`${{ covered: '摘要已覆盖', recent: '近期原文', gap: '记忆缺口', pending: '待压缩', deprecated: '弃用 · 不参与召回', trash: '回收站 · 不参与召回' }[r.type]} · ${r.count} 轮`}
          >
            {selectedIndex >= r.start && selectedIndex < r.start + r.count && (
              <svg
                className="chain-cursor"
                viewBox="0 0 12 24"
                aria-label={`当前第 ${selectedNumber} 轮，共 ${w.turns.length} 轮`}
                style={{
                  left: `${((selectedIndex - r.start + 0.5) / r.count) * 100}%`,
                }}
              >
                <title>{`读到这里 · 第 ${selectedNumber} 轮`}</title>
                <path d="M6 14V24" stroke="currentColor" />
                <path d="M1 0H11V16L6 12L1 16Z" fill="currentColor" />
                <path d="M3 2H9" stroke="#f7efd8" strokeOpacity="0.65" />
              </svg>
            )}
          </div>
        ))}
      </div>
      <div className="chain-labels">
        <span>
          <i className="covered" />
          摘要覆盖 {c.covered.length} 轮
        </span>
        {c.gap.length > 0 && (
          <span className="amber">
            <i className="gap" />
            缺口 {c.gap.length} 轮
          </span>
        )}
        {c.queued.length > 0 && (
          <span>
            <i className="pending" />
            窗口之后 {c.queued.length} 轮
          </span>
        )}
        {inactiveCount > 0 && (
          <span>
            <i className="inactive" />
            不参与召回 {inactiveCount} 轮
          </span>
        )}
        <span>
          <i className="recent" />
          原文窗口 {c.recent.length} 轮
        </span>
      </div>
    </div>
  );
}
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
