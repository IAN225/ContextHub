import { attachmentContext } from '../attachments/content.ts';
import { type Block, type WorkspaceContext } from '../core/model.ts';
import { coverage } from '../summary/coverage.ts';
import { summaryWorkspace, type SummaryEngine } from '../summary/engines.ts';

export function memoryText(
  w: WorkspaceContext,
  blocks = w.blocks,
  engine: SummaryEngine = w.summaryEngine ?? w.memoryEngine ?? 'custom',
) {
  w = summaryWorkspace(w, engine);
  const c = coverage(w);
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text ?? '';
      if (b.type === 'summary')
        return b.custom
          ? `[自定义摘要]\n${b.text ?? ''}`
          : `[当前活跃摘要]\n${c.active?.text ?? '尚无活跃摘要'}`;
      if (b.type === 'stars')
        return `[${b.custom ? '自选 Note id 列表' : '标星 Note id 列表'}]\n${
          memoryNotes(w, b)
            .map((n) => `${n.id} · ${n.title}`)
            .join('\n') || (b.custom ? '未选择笔记' : '暂无标星笔记')
        }`;
      const turns = b.custom
        ? coverage({
            ...w,
            retain: Math.max(0, Math.floor(b.windowLength ?? 0)),
            retainMode: 'turns',
          }).recent
        : c.recent;
      return `[${b.custom ? '自选滑动窗口' : '近期原文'}]\n${turns.map((t) => [t.messages.map((m) => `${m.role}: ${m.content}`).join('\n'), ...(t.attachments?.length ? [`[附件资料]\n${JSON.stringify(t.attachments.map(attachmentContext))}`] : [])].join('\n')).join('\n\n')}`;
    })
    .join('\n\n');
}

export function memoryNotes(w: WorkspaceContext, b: Block) {
  if (!b.custom) return w.notes.filter((n) => n.star && n.status === 'normal');
  return [...new Set(b.noteIds ?? [])].flatMap((id) => {
    const note = w.notes.find((n) => n.id === id && n.status === 'normal');
    return note ? [note] : [];
  });
}

export function memoryBlockLabel(b: Block) {
  if (b.type === 'text') return '自定义文本';
  if (b.type === 'summary') return b.custom ? '自定义摘要' : '当前活跃摘要';
  if (b.type === 'recent') return b.custom ? '自选滑动窗口' : '原文滑动窗口';
  return b.custom ? '自选 Note id 列表' : '标星 Note id 列表';
}
