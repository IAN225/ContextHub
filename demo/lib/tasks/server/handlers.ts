import {
  coverage,
  now,
  uid,
  type Attachment,
  type Workspace,
} from '../../domain.ts';
import { normalizeHubState } from '../../hub-state.ts';
import {
  attachmentRevision,
  attachmentStatus,
  fingerprintAttachment,
} from '../../attachments.ts';
import {
  digest,
  randomSecret,
  requireManagementRequest,
} from '../../imports/server/auth.ts';
import {
  discardRequestBody,
  readLimitedBody,
} from '../../imports/server/share-service.ts';
import {
  applyGeneratedCheckpoint,
  checkpointFromResult,
  planCompression,
  planWorkbench,
  summaryRevision,
} from '../../summary/planning.ts';
import {
  resolveSummaryConnection,
  type SummaryEnvironment,
} from '../../summary/server/config.ts';
import { generateSummary } from '../../summary/server/service.ts';
import { summaryTaskWorkspace } from '../snapshot.ts';
import {
  MAX_TASK_BYTES,
  publicTask,
  TaskError,
  type AttachmentTaskState,
  type SummaryTaskState,
  type WorkbenchTaskState,
  type TaskRecord,
} from '../contracts.ts';
import type { TaskRepository } from './repository.ts';

export type TaskEnvironment = SummaryEnvironment & {
  CONTEXT_HUB_TASK_RUNNER_KEY?: string;
};
const headers = { 'Cache-Control': 'no-store' };
const COOKIE = 'context_hub_tasks';
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
async function body(request: Request, limit = MAX_TASK_BYTES) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new TaskError('JSON_REQUIRED', '请使用 JSON 请求。', 415);
  try {
    return object(JSON.parse(await readLimitedBody(request, limit)));
  } catch (error) {
    if (error instanceof Error && 'status' in error) throw error;
    throw new TaskError('INVALID_JSON', '任务数据格式无效。');
  }
}
async function owner(request: Request, repo: TaskRepository) {
  const secret = request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return secret && /^[a-f0-9]{64}$/.test(secret)
    ? repo.session(await digest(secret))
    : undefined;
}
async function connectionHash(w: Workspace, env: TaskEnvironment) {
  const c = resolveSummaryConnection(w.config, env);
  return digest(JSON.stringify(c));
}
function runtimeReady(env: TaskEnvironment) {
  return Boolean(env.CONTEXT_HUB_TASK_RUNNER_KEY);
}
async function requireRunner(request: Request, env: TaskEnvironment) {
  const key = request.headers.get('x-context-hub-runner') ?? '';
  if (
    !env.CONTEXT_HUB_TASK_RUNNER_KEY ||
    !key ||
    (await digest(key)) !== (await digest(env.CONTEXT_HUB_TASK_RUNNER_KEY))
  )
    throw new TaskError('FORBIDDEN', '任务执行器未授权。', 403);
}
async function runSummary(
  task: TaskRecord,
  repo: TaskRepository,
  env: TaskEnvironment,
  fetcher?: typeof fetch,
) {
  try {
    const state = await repo.read<SummaryTaskState>(task.id, 'state');
    if (!state)
      throw new TaskError('MISSING_TASK_DATA', '任务输入已经不可用。');
    const w = state.workspace;
    if ((await connectionHash(w, env)) !== task.connection_hash)
      throw new TaskError(
        'CONNECTION_CHANGED',
        '本地模型连接已变化。请取消旧任务，再按当前连接开始压缩。',
      );
    if (task.kind === 'workbench') {
      const input = state as WorkbenchTaskState;
      const plan = planWorkbench(
        w,
        w.turns.filter(
          (t) => input.turnIds.includes(t.id) && t.status === 'normal',
        ),
        w.summaries.find((s) => s.id === input.summaryId),
        input.instruction,
      );
      const result = await generateSummary(plan.input, env, undefined, fetcher);
      await repo.progress(
        task,
        state,
        {
          kind: 'workbench',
          upload: {
            id: `candidate-${task.id}`,
            title: '工作台候选摘要',
            kind: 'summary',
            channel: 'workbench',
            source: `摘要工作台 · ${result.model}`,
            turns: [],
            workspaceId: w.id,
            covered: plan.covered,
            summaryText: result.text,
            createdAt: now(),
          },
        },
        'completed',
      );
      return;
    }
    const plan = planCompression(w);
    if (!plan)
      throw new TaskError('NO_PENDING_TURNS', '任务已没有待压缩轮次。');
    // This request is owned by the local runner, never a browser tab lifecycle.
    const response = await generateSummary(plan.input, env, undefined, fetcher);
    const generated = checkpointFromResult(plan, response, uid(), now());
    const next = applyGeneratedCheckpoint(w, generated);
    await repo.progress(
      task,
      { workspace: next },
      {
        kind: 'summary',
        expectedHash: await digest(summaryRevision(w)),
        summary: generated.summary,
        turnIds: generated.turnIds,
      },
      !coverage(next).pending.length
        ? 'completed'
        : w.config.review
          ? 'paused'
          : 'queued',
    );
  } catch (error) {
    await repo.fail(
      task,
      error instanceof Error && 'code' in error
        ? error.message
        : '摘要任务未完成，已暂停。请检查本地服务后手动重试。',
    );
  }
}
export async function taskHandler(
  request: Request,
  action: string,
  repo: TaskRepository,
  env: TaskEnvironment,
  fetcher?: typeof fetch,
) {
  try {
    if (action.startsWith('runner-')) {
      await requireRunner(request, env);
      if (request.method !== 'POST')
        throw new TaskError('METHOD', '请求方法不支持。', 405);
      if (action === 'runner-claim') {
        const task = await repo.claim();
        if (!task) return Response.json({ task: null }, { headers });
        const state =
          task.kind === 'attachments'
            ? await repo.read<AttachmentTaskState>(task.id, 'state')
            : null;
        return Response.json(
          {
            task: {
              id: task.id,
              lease: task.lease,
              kind: task.kind,
              attachment: state?.attachments[task.step],
            },
          },
          { headers },
        );
      }
      const data = await body(request, 8 * 1024 * 1024);
      const task = typeof data.id === 'string' ? await repo.get(data.id) : null;
      if (
        !task ||
        task.lease !== data.lease ||
        !['running', 'pausing'].includes(task.status)
      )
        return Response.json({ accepted: false }, { headers });
      if (
        action === 'runner-summary' &&
        ['summary', 'workbench'].includes(task.kind)
      ) {
        await runSummary(task, repo, env, fetcher);
        return Response.json({ accepted: true }, { headers });
      }
      if (action === 'runner-attachment' && task.kind === 'attachments') {
        const state = await repo.read<AttachmentTaskState>(task.id, 'state');
        const original = state?.attachments[task.step];
        if (!state || !original)
          throw new TaskError('MISSING_TASK_DATA', '附件任务输入缺失。');
        let attachment: Attachment;
        try {
          if (typeof data.url !== 'string')
            throw new Error(
              typeof data.error === 'string'
                ? data.error.slice(0, 300)
                : '附件未能获取。',
            );
          attachment = await fingerprintAttachment({
            ...original,
            url: data.url,
            sourceUrl: original.sourceUrl || original.url,
          });
        } catch (error) {
          attachment = {
            ...original,
            status: 'failed',
            error: error instanceof Error ? error.message : '附件获取失败。',
          };
        }
        await repo.progress(
          task,
          state,
          {
            kind: 'attachments',
            expected: attachmentRevision(original),
            attachment,
          },
          task.step + 1 === state.attachments.length ? 'completed' : 'queued',
        );
        return Response.json({ accepted: true }, { headers });
      }
      throw new TaskError('NOT_FOUND', '未知执行器操作。', 404);
    }
    requireManagementRequest(request);
    let session = await owner(request, repo);
    if (action === 'session' && request.method === 'POST') {
      let cookie: string | undefined;
      if (!session) {
        const value = randomSecret('');
        session = await repo.createSession(await digest(value));
        cookie = `${COOKIE}=${value}; Path=/api/tasks; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
      }
      return Response.json(
        { ready: runtimeReady(env) },
        {
          headers: { ...headers, ...(cookie ? { 'Set-Cookie': cookie } : {}) },
        },
      );
    }
    if (action === 'list' && request.method === 'GET')
      return Response.json(
        {
          ready: runtimeReady(env),
          tasks: session ? (await repo.list(session)).map(publicTask) : [],
        },
        { headers },
      );
    if (!session)
      throw new TaskError(
        'SESSION_REQUIRED',
        '任务会话未建立，请刷新页面后重试。',
        401,
      );
    if (action === 'enqueue' && request.method === 'POST') {
      if (!runtimeReady(env))
        throw new TaskError(
          'RUNNER_UNAVAILABLE',
          '请通过 pnpm start 或启动脚本运行本地后台服务。',
          503,
        );
      const data = await body(request);
      if (typeof data.id !== 'string' || !/^[a-z0-9_-]{16,100}$/i.test(data.id))
        throw new TaskError('INVALID_ID', '任务编号无效。');
      let state: SummaryTaskState | AttachmentTaskState | WorkbenchTaskState;
      let title: string,
        workspaceId: string | null = null,
        connection: string | null = null,
        total = 0;
      if (data.kind === 'summary' || data.kind === 'workbench') {
        const normalized = normalizeHubState({
          schemaVersion: 1,
          workspaces: [data.workspace],
          uploads: [],
        }).workspaces[0];
        const w = summaryTaskWorkspace(normalized);
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
            (data.summaryId &&
              !w.summaries.some((s) => s.id === data.summaryId))
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
        connection = await connectionHash(w, env);
        title = `${w.name} · ${data.kind === 'workbench' ? '工作台候选' : '摘要压缩'}`;
        workspaceId = w.id;
      } else if (data.kind === 'attachments') {
        if (
          !Array.isArray(data.attachments) ||
          !data.attachments.length ||
          data.attachments.length > 30
        )
          throw new TaskError(
            'INVALID_ATTACHMENTS',
            '每次请选择 1–30 个附件。',
          );
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
          return a as Attachment;
        });
        state = { attachments };
        title = `${attachments.length} 个附件`;
        total = attachments.length;
      } else throw new TaskError('INVALID_KIND', '不支持的后台任务。');
      const at = Date.now();
      const record: TaskRecord = {
        id: data.id,
        owner_id: session,
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
      return Response.json(
        { task: publicTask(await repo.enqueue(record, state)) },
        { headers },
      );
    }
    const url = new URL(request.url);
    const data =
      request.method === 'GET'
        ? {
            id: url.searchParams.get('id'),
            step: Number(url.searchParams.get('step')),
          }
        : await body(request, 8192);
    if (action === 'cancel-all' && request.method === 'POST') {
      for (const task of await repo.list(session))
        if (task.status !== 'cancelled')
          await repo.control(session, task.id, 'cancel');
      return Response.json({ ok: true }, { headers });
    }
    const task = typeof data.id === 'string' ? await repo.get(data.id) : null;
    if (!task || task.owner_id !== session)
      throw new TaskError('NOT_FOUND', '任务不存在。', 404);
    if (action === 'result' && request.method === 'GET') {
      if (
        !Number.isInteger(data.step) ||
        Number(data.step) < 1 ||
        Number(data.step) > task.step
      )
        throw new TaskError('INVALID_STEP', '任务结果序号无效。');
      return Response.json(
        { result: await repo.read(task.id, `result:${Number(data.step)}`) },
        { headers },
      );
    }
    if (action === 'ack' && request.method === 'POST') {
      if (
        !Number.isInteger(data.step) ||
        Number(data.step) < 1 ||
        Number(data.step) > task.step
      )
        throw new TaskError('INVALID_STEP', '结果接收序号无效。');
      await repo.acknowledge(session, task.id, Number(data.step));
      return Response.json({ ok: true }, { headers });
    }
    if (
      action === 'control' &&
      request.method === 'POST' &&
      ['pause', 'resume', 'cancel'].includes(String(data.action))
    ) {
      let resumeState: SummaryTaskState | undefined;
      if (data.action === 'resume' && task.kind === 'summary') {
        if (task.step > task.acknowledged)
          throw new TaskError(
            'RECEIVE_FIRST',
            '请先接收已生成的检查点，再继续任务。',
            409,
          );
        const state = await repo.read<SummaryTaskState>(task.id, 'state');
        if (
          !state ||
          data.expectedHash !== (await digest(summaryRevision(state.workspace)))
        )
          throw new TaskError(
            'STALE_TASK',
            '原文或配置已变化，请取消旧任务，再按当前内容重新开始。',
            409,
          );
        if (typeof data.review === 'boolean') {
          state.workspace.config.review = data.review;
          resumeState = state;
        }
      }
      return Response.json(
        {
          task: publicTask(
            await repo.control(
              session,
              task.id,
              data.action as 'pause' | 'resume' | 'cancel',
              resumeState,
            ),
          ),
        },
        { headers },
      );
    }
    throw new TaskError('NOT_FOUND', '未知任务操作。', 404);
  } catch (error) {
    const known =
      error instanceof Error && 'status' in error && 'code' in error;
    return Response.json(
      {
        error: {
          code: known ? error.code : 'TASK_FAILED',
          message: known
            ? error.message
            : '后台任务服务暂不可用，请检查本地服务与数据库迁移。',
        },
      },
      { status: known ? Number(error.status) : 500, headers },
    );
  } finally {
    // Even successful bodyless actions (session/claim) must drain a POST body
    // before returning so Wrangler's HTTP proxy can reuse its connection.
    if (!request.bodyUsed) await discardRequestBody(request);
  }
}
