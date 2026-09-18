import {
  attachmentRevision,
  fingerprintAttachment,
} from '../../attachments.ts';
import { type Attachment } from '../../core/model.ts';
import { type SummaryEngine } from '../../summary/engines.ts';
import { type SummaryEnvironment } from '../../summary/server/config.ts';
import { TaskError, type AttachmentTaskState } from '../contracts.ts';
import { body, headers, requireRunner, type TaskEnvironment } from './http.ts';
import type { TaskRepository } from './repository.ts';
import { runSummary } from './summary-runner.ts';

export async function handleRunner(
  request: Request,
  action: string,
  repo: TaskRepository,
  env: TaskEnvironment,
  fetcher?: typeof fetch,
  connectionForOwner?: (
    owner: string,
    engine: SummaryEngine,
  ) => Promise<SummaryEnvironment>,
) {
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
    await runSummary(
      task,
      repo,
      connectionForOwner
        ? {
            ...env,
            ...(await connectionForOwner(
              task.owner_id,
              task.engine ?? 'custom',
            )),
          }
        : env,
      fetcher,
    );
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
