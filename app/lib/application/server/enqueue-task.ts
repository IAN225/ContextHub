import { attachmentStatus } from '../../attachments/content.ts';
import { type Attachment } from '../../core/model.ts';
import { digest } from '../../server/crypto.ts';
import { coverage } from '../../summary/coverage.ts';
import {
  engineLabels,
  parseModelSummaryEngine,
  summaryWorkspace,
  type ModelSummaryEngine,
} from '../../summary/engines.ts';
import {
  planCompression,
  planWorkbench,
  summaryRevision,
} from '../../summary/planning.ts';
import { type SummaryEnvironment } from '../../summary/server/config.ts';
import {
  publicTask,
  TaskError,
  type AttachmentTaskState,
  type SummaryTaskState,
  type TaskRecord,
  type WorkbenchTaskState,
} from '../../tasks/contracts.ts';
import {
  connectionHash,
  object,
  runtimeReady,
  type TaskEnvironment,
} from '../../tasks/server/http.ts';
import { summaryTaskWorkspace } from '../../tasks/snapshot.ts';
import type { TaskService } from './tasks.ts';

export async function enqueueTask(
  repo: TaskService,
  session: string,
  data: Record<string, unknown>,
  env: TaskEnvironment,
  connectionForOwner?: (
    owner: string,
    engine: ModelSummaryEngine,
  ) => Promise<SummaryEnvironment>,
) {
  if (!runtimeReady(env))
    throw new TaskError(
      'RUNNER_UNAVAILABLE',
      '后台执行器尚未就绪，请检查服务器运行状态。',
      503,
    );
  if (typeof data.id !== 'string' || !/^[a-z0-9_-]{16,100}$/i.test(data.id))
    throw new TaskError('INVALID_ID', '任务编号无效。');
  const initial = repo.application.read(session);
  let state: SummaryTaskState | AttachmentTaskState | WorkbenchTaskState;
  let title: string,
    workspaceId: string | null = null,
    connection: string | null = null,
    total = 0;
  let engine: ModelSummaryEngine = 'custom';
  if (data.kind === 'summary' || data.kind === 'workbench') {
    const requested = object(data.workspace);
    const normalized = initial.state.workspaces.find(
      (w) => w.id === (data.workspaceId ?? requested.id),
    );
    if (!normalized) throw new TaskError('NOT_FOUND', '工作区已不存在。', 404);
    if ((data.engine ?? requested.summaryEngine) === 'client')
      throw new TaskError(
        'INVALID_ENGINE',
        '客户端压缩由 MCP 客户端提交，不创建模型任务。',
      );
    const w = summaryTaskWorkspace(
      summaryWorkspace(
        normalized,
        parseModelSummaryEngine(data.engine ?? requested.summaryEngine),
      ),
    );
    if (
      typeof data.expectedHash === 'string' &&
      data.expectedHash !== (await digest(summaryRevision(w)))
    )
      throw new TaskError('STALE_INPUT', '任务输入已变化，请刷新后重试。', 409);
    engine = parseModelSummaryEngine(w.summaryEngine);
    if (data.kind === 'workbench' && engine !== 'custom')
      throw new TaskError(
        'INVALID_ENGINE',
        '自定义摘要工作台仅属于自定义压缩。',
      );
    if (data.kind === 'workbench') {
      if (
        !Array.isArray(data.turnIds) ||
        !data.turnIds.length ||
        !data.turnIds.every((id) => typeof id === 'string') ||
        typeof data.instruction !== 'string' ||
        data.instruction.length > 20000 ||
        typeof data.summaryId !== 'string'
      )
        throw new TaskError('INVALID_WORKBENCH', '工作台选区或要求无效。');
      const ids = data.turnIds as string[];
      const turns = w.turns.filter(
        (t) => ids.includes(t.id) && t.status === 'normal',
      );
      if (
        turns.length !== new Set(ids).size ||
        (data.summaryId && !w.summaries.some((s) => s.id === data.summaryId))
      )
        throw new TaskError(
          'INVALID_WORKBENCH',
          '工作台引用的原文或摘要已不存在。',
        );
      planWorkbench(
        w,
        turns,
        w.summaries.find((s) => s.id === data.summaryId),
        data.instruction,
      );
      state = {
        workspace: w,
        turnIds: ids,
        summaryId: data.summaryId,
        instruction: data.instruction,
      };
      total = 1;
    } else {
      planCompression(w);
      total = coverage(w).pending.length;
      if (!total)
        throw new TaskError('NO_PENDING_TURNS', '当前没有需要压缩的原文。');
      state = { workspace: w };
    }
    connection = await connectionHash(
      w,
      connectionForOwner ? await connectionForOwner(session, engine) : env,
    );
    title = `${w.name} · ${data.kind === 'workbench' ? '工作台候选' : engineLabels[engine]}`;
    workspaceId = w.id;
  } else if (data.kind === 'attachments') {
    if (
      !Array.isArray(data.attachments) ||
      !data.attachments.length ||
      data.attachments.length > 30
    )
      throw new TaskError('INVALID_ATTACHMENTS', '每次请选择 1–30 个附件。');
    const account = initial.state;
    const owned = [
      ...account.workspaces.flatMap((w) => w.turns),
      ...account.uploads.flatMap((u) => u.turns),
    ]
      .filter((t) => t.status !== 'trash')
      .flatMap((t) => t.attachments ?? []);
    const attachments = data.attachments.map((raw) => {
      const a = object(raw);
      if (
        !['id', 'name', 'type', 'url'].every(
          (key) => typeof a[key] === 'string',
        ) ||
        !['remote', 'failed'].includes(attachmentStatus(a as Attachment)) ||
        !String(a.sourceUrl || a.url).startsWith('https://')
      )
        throw new TaskError(
          'INVALID_ATTACHMENT',
          '附件没有可获取的 HTTPS 来源。',
        );
      const actual = owned.find(
        (item) =>
          item.id === a.id &&
          (item.sourceUrl || item.url) === (a.sourceUrl || a.url),
      );
      if (!actual)
        throw new TaskError('NOT_FOUND', '附件已不存在或不属于此账号。', 404);
      return actual;
    });
    state = { attachments };
    title = `${attachments.length} 个附件`;
    total = attachments.length;
  } else throw new TaskError('INVALID_KIND', '不支持的后台任务。');
  await repo.accountSession(session);
  const at = Date.now();
  const record: TaskRecord = {
    id: data.id,
    owner_id: session,
    generation: initial.generation,
    engine,
    kind: data.kind,
    title,
    workspace_id: workspaceId,
    status: 'queued',
    request_hash: await digest(JSON.stringify(state)),
    connection_hash: connection,
    total,
    step: 0,
    acknowledged: 0,
    lease: null,
    lease_until: null,
    error: null,
    created_at: at,
    updated_at: at,
  };
  return publicTask(await repo.enqueue(record, state));
}
