import { enqueueTask } from '../../application/server/enqueue-task.ts';
import type { TaskService } from '../../application/server/tasks.ts';
import { discardRequestBody } from '../../server/body.ts';
import { digest } from '../../server/crypto.ts';
import { type ModelSummaryEngine } from '../../summary/engines.ts';
import { summaryRevision } from '../../summary/planning.ts';
import { type SummaryEnvironment } from '../../summary/server/config.ts';
import { publicTask, TaskError, type SummaryTaskState } from '../contracts.ts';
import {
  body,
  headers,
  requireManagementRequest,
  runtimeReady,
  type TaskEnvironment,
} from './http.ts';
import { handleRunner } from './runner.ts';
export async function taskHandler(
  request: Request,
  action: string,
  repo: TaskService,
  env: TaskEnvironment,
  fetcher?: typeof fetch,
  accountId?: string,
  connectionForOwner?: (
    owner: string,
    engine: ModelSummaryEngine,
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
    if (!accountId) throw new TaskError('UNAUTHORIZED', '请先登录。', 401);
    repo.application.requireOwner(accountId);
    const session = await repo.accountSession(accountId);
    if (action === 'session' && request.method === 'POST')
      return Response.json({ ready: runtimeReady(env) }, { headers });
    if (action === 'list' && request.method === 'GET')
      return Response.json(
        {
          ready: runtimeReady(env),
          tasks: session ? (await repo.list(session)).map(publicTask) : [],
          candidates: repo.candidates(session),
        },
        { headers },
      );
    if (!session)
      throw new TaskError(
        'SESSION_REQUIRED',
        '任务会话未建立，请刷新页面后重试。',
        401,
      );
    if (action === 'enqueue' && request.method === 'POST')
      return Response.json(
        {
          task: await enqueueTask(
            repo,
            session,
            await body(request),
            env,
            connectionForOwner,
          ),
        },
        { headers },
      );
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
    if (action === 'ack')
      throw new TaskError('UPGRADE_REQUIRED', '服务已升级，请刷新页面。', 426);
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
