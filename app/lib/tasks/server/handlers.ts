import { attachmentStatus } from '../../attachments.ts';
import { type Attachment } from '../../core/model.ts';
import {
  digest,
  randomSecret,
  requireManagementRequest,
} from '../../imports/server/auth.ts';
import { discardRequestBody } from '../../imports/server/share-service.ts';
import { normalizeHubState } from '../../state/validation.ts';
import { coverage } from '../../summary/coverage.ts';
import {
  engineLabels,
  parseSummaryEngine,
  type SummaryEngine,
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
} from '../contracts.ts';
import { summaryTaskWorkspace } from '../snapshot.ts';
import {
  body,
  connectionHash,
  COOKIE,
  headers,
  object,
  owner,
  runtimeReady,
  type TaskEnvironment,
} from './http.ts';
import type { TaskRepository } from './repository.ts';
import { handleRunner } from './runner.ts';
export async function taskHandler(
  request: Request,
  action: string,
  repo: TaskRepository,
  env: TaskEnvironment,
  fetcher?: typeof fetch,
  accountId?: string,
  connectionForOwner?: (
    owner: string,
    engine: SummaryEngine,
  ) => Promise<SummaryEnvironment>,
) {
  try {
    if (action.startsWith('runner-'))
      return await handleRunner(
        request,
        action,
        repo,
        env,
        fetcher,
        connectionForOwner,
      );
    requireManagementRequest(request);
    let session = accountId
      ? await repo.accountSession(accountId)
      : await owner(request, repo);
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
          '后台执行器尚未就绪，请检查服务器运行状态。',
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
      let engine: SummaryEngine = 'custom';
      if (data.kind === 'summary' || data.kind === 'workbench') {
        const normalized = normalizeHubState({
          schemaVersion: 1,
          workspaces: [data.workspace],
          uploads: [],
        }).workspaces[0];
        const w = summaryTaskWorkspace(normalized);
        engine = parseSummaryEngine(w.summaryEngine);
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
