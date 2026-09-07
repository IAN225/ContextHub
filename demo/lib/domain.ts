export type Status = 'normal' | 'deprecated' | 'trash';
export type Message = {
  role: string;
  content: string;
  name?: string;
  callId?: string;
};
export type Attachment = {
  id: string;
  name: string;
  type: string;
  url: string;
};
export type Turn = {
  id: string;
  title: string;
  messages: Message[];
  status: Status;
  source: string;
  time: string | null;
  deletedAt?: string;
  attachments?: Attachment[];
  tokens?: number;
  cache?: number;
};
export type Summary = {
  id: string;
  title: string;
  text: string;
  covered: string[];
  createdAt: string;
};
export type Note = {
  id: string;
  title: string;
  body: string;
  star: boolean;
  status: Status;
  createdAt: string;
  updatedAt: string;
  editor: string;
  source: string;
  deletedAt?: string;
  versions: { title: string; body: string; time: string }[];
};
export type Block = {
  id: string;
  type: 'text' | 'summary' | 'recent' | 'stars';
  text?: string;
};
export type Token = {
  id: string;
  name: string;
  value: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  kind: 'token' | 'oauth';
};
export type Config = {
  configured: boolean;
  auto: boolean;
  batch: number;
  review: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  protocol?: string;
  system?: string;
  promptBlocks?: Block[];
  budget?: number;
  maxOutput?: number;
  thinking?: string;
  outputField?: string;
};
export type Workspace = {
  id: string;
  name: string;
  platform: string;
  turns: Turn[];
  summaries: Summary[];
  activeId: string | null;
  watermark: string | null;
  retain: number;
  notes: Note[];
  blocks: Block[];
  tokens: Token[];
  config: Config;
  started: boolean;
  firstComplete?: boolean;
};
export type Upload = {
  id: string;
  title: string;
  source: string;
  turns: Turn[];
  warning?: string;
  kind: 'conversation' | 'summary';
  summaryText?: string;
  createdAt: string;
  workspaceId?: string;
  covered?: string[];
};
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const now = () => new Date().toISOString();
export function groupTurns(messages: Message[], source = '文本粘贴'): Turn[] {
  const turns: Turn[] = [];
  for (const m of messages) {
    if (
      !['user', 'assistant', 'tool', 'tool_call', 'tool_result'].includes(
        m.role,
      )
    )
      continue;
    if (m.role === 'user')
      turns.push({
        id: uid(),
        title: m.content.slice(0, 36) || '附件对话',
        messages: [],
        status: 'normal',
        source,
        time: null,
      });
    if (turns.length)
      turns[turns.length - 1].messages.push({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
        ...(m.callId ? { callId: m.callId } : {}),
      });
  }
  return turns;
}
export function coverage(w: Workspace) {
  const active = w.summaries.find((s) => s.id === w.activeId);
  const included = new Set(active?.covered ?? []);
  const at = w.turns.findIndex((t) => t.id === w.watermark);
  const normal = w.turns.filter((t) => t.status === 'normal');
  const recent = w.turns
    .filter((t, i) => t.status === 'normal' && i > at)
    .slice(0, w.retain);
  const retainedAtEnd = new Set(
    normal.slice(Math.max(0, normal.length - w.retain)).map((t) => t.id),
  );
  const recentIds = new Set(recent.map((t) => t.id));
  const covered = w.turns.filter(
    (t) => t.status === 'normal' && included.has(t.id),
  );
  const gap = w.turns.filter(
    (t, i) =>
      t.status === 'normal' &&
      i <= at &&
      !included.has(t.id) &&
      !recentIds.has(t.id),
  );
  const pending = w.turns.filter(
    (t, i) => t.status === 'normal' && i > at && !retainedAtEnd.has(t.id),
  );
  const queued = w.turns.filter(
    (t, i) =>
      t.status === 'normal' &&
      i > at &&
      !recentIds.has(t.id) &&
      !included.has(t.id),
  );
  return { active, covered, gap, pending, recent, queued, at };
}
export function restoreSummary(
  w: Workspace,
  id: string,
  mode: 'keep' | 'rewind',
): Workspace {
  const s = w.summaries.find((s) => s.id === id);
  if (!s) return w;
  const last = w.turns.filter((t) => s.covered.includes(t.id)).at(-1);
  return {
    ...w,
    activeId: id,
    watermark: mode === 'rewind' ? (last?.id ?? null) : w.watermark,
  };
}
export function compressBatch(w: Workspace): Workspace {
  const c = coverage(w),
    batch = c.pending.slice(0, Math.max(1, w.config.batch));
  if (!batch.length || !w.config.configured) return w;
  const summary: Summary = {
    id: uid(),
    title: '增量摘要',
    createdAt: now(),
    covered: [
      ...new Set([...(c.active?.covered ?? []), ...batch.map((t) => t.id)]),
    ],
    text: [
      c.active?.text ?? '## 对话延续提示',
      `\n### 新增记忆（演示摘录 · ${batch.length} 轮）`,
      ...batch.map(
        (t) =>
          `- ${t.messages.find((m) => m.role === 'user')?.content.slice(0, 140) ?? t.title}`,
      ),
    ].join('\n'),
  };
  return {
    ...w,
    summaries: [...w.summaries, summary].slice(-30),
    activeId: summary.id,
    watermark: batch.at(-1)!.id,
    started: true,
    firstComplete: w.firstComplete || c.pending.length <= batch.length,
  };
}
export function memoryText(w: Workspace, blocks = w.blocks) {
  const c = coverage(w);
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text ?? '';
      if (b.type === 'summary')
        return `[当前活跃摘要]\n${c.active?.text ?? '尚无活跃摘要'}`;
      if (b.type === 'stars')
        return `[标星 Note id 列表]\n${
          w.notes
            .filter((n) => n.star && n.status === 'normal')
            .map((n) => `${n.id} · ${n.title}`)
            .join('\n') || '暂无标星笔记'
        }`;
      return `[近期原文]\n${c.recent.map((t) => t.messages.map((m) => `${m.role}: ${m.content}`).join('\n')).join('\n\n')}`;
    })
    .join('\n\n');
}
export function blankWorkspace(name: string, platform = '手动导入'): Workspace {
  return {
    id: uid(),
    name,
    platform,
    turns: [],
    summaries: [],
    activeId: null,
    watermark: null,
    retain: 6,
    notes: [],
    blocks: [
      { id: uid(), type: 'summary' },
      { id: uid(), type: 'recent' },
      { id: uid(), type: 'stars' },
    ],
    tokens: [],
    config: { configured: false, auto: false, batch: 20, review: true },
    started: false,
    firstComplete: false,
  };
}
