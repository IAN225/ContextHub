import { uid } from '../../domain.ts';
import {
  MAX_TASK_BYTES,
  TASK_LEASE_MS,
  TaskError,
  type TaskRecord,
  type TaskStatus,
} from '../contracts.ts';

const CHUNK_CHARS = 100000; // <= 400 KB even for four-byte Unicode.
function parts(value: unknown) {
  const json = JSON.stringify(value);
  if (new TextEncoder().encode(json).length > MAX_TASK_BYTES)
    throw new TaskError(
      'TASK_TOO_LARGE',
      '任务数据超过 16 MB，请缩小范围。',
      413,
    );
  const result: string[] = [];
  for (let at = 0; at < json.length; at += CHUNK_CHARS) {
    let end = Math.min(at + CHUNK_CHARS, json.length);
    // Do not split UTF-16 surrogate pairs between SQLite text cells.
    if (end < json.length && /[\uD800-\uDBFF]/.test(json[end - 1])) end--;
    result.push(json.slice(at, end));
    at = end - CHUNK_CHARS;
  }
  return result;
}
export function taskRepository(db: D1Database) {
  const bind = (sql: string, ...args: unknown[]) =>
    db.prepare(sql).bind(...args);
  const get = (id: string) =>
    bind('SELECT * FROM background_tasks WHERE id = ?', id).first<TaskRecord>();
  function insertChunks(
    id: string,
    slot: string,
    value: unknown,
    lease?: string,
  ) {
    return parts(value).map((body, part) =>
      lease
        ? bind(
            `INSERT INTO task_chunks(task_id,slot,part,body) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND lease=? AND status IN ('running','pausing'))`,
            id,
            slot,
            part,
            body,
            id,
            lease,
          )
        : bind(
            'INSERT INTO task_chunks(task_id,slot,part,body) VALUES(?,?,?,?)',
            id,
            slot,
            part,
            body,
          ),
    );
  }
  return {
    get,
    async session(hash: string) {
      return (
        await bind(
          'SELECT id FROM task_sessions WHERE session_hash=?',
          hash,
        ).first<{ id: string }>()
      )?.id;
    },
    async createSession(hash: string) {
      const id = uid();
      await bind(
        'INSERT INTO task_sessions(id,session_hash,created_at) VALUES(?,?,?)',
        id,
        hash,
        Date.now(),
      ).run();
      return id;
    },
    async list(owner: string) {
      return (
        await bind(
          "SELECT * FROM background_tasks WHERE owner_id=? ORDER BY (status NOT IN ('completed','cancelled') OR step > acknowledged) DESC, created_at DESC LIMIT 100",
          owner,
        ).all<TaskRecord>()
      ).results;
    },
    async read<T>(id: string, slot: string): Promise<T | null> {
      const chunks = (
        await bind(
          'SELECT body FROM task_chunks WHERE task_id=? AND slot=? ORDER BY part',
          id,
          slot,
        ).all<{ body: string }>()
      ).results;
      return chunks.length
        ? (JSON.parse(chunks.map((c) => c.body).join('')) as T)
        : null;
    },
    async enqueue(task: TaskRecord, state: unknown) {
      const existing = await get(task.id);
      if (existing) {
        if (
          existing.owner_id !== task.owner_id ||
          existing.request_hash !== task.request_hash
        )
          throw new TaskError(
            'TASK_CONFLICT',
            '同一任务编号对应了不同内容。',
            409,
          );
        return existing;
      }
      // A partial unique index is unsuitable for pausing/completed-but-unreceived
      // summary tasks, so duplicate workspace work is checked in the atomic INSERT.
      const insert = bind(
        `INSERT INTO background_tasks(id,owner_id,kind,title,workspace_id,status,request_hash,connection_hash,total,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?
        WHERE (SELECT COUNT(*) FROM background_tasks WHERE owner_id=? AND (status NOT IN ('completed','cancelled') OR step > acknowledged)) < 20
          AND (? <> 'summary' OR NOT EXISTS(SELECT 1 FROM background_tasks WHERE owner_id=? AND kind='summary' AND workspace_id=? AND (status NOT IN ('completed','cancelled') OR step > acknowledged)))`,
        task.id,
        task.owner_id,
        task.kind,
        task.title,
        task.workspace_id,
        task.status,
        task.request_hash,
        task.connection_hash,
        task.total,
        task.created_at,
        task.updated_at,
        task.owner_id,
        task.kind,
        task.owner_id,
        task.workspace_id,
      );
      const chunks = parts(state).map((body, part) =>
        bind(
          'INSERT INTO task_chunks(task_id,slot,part,body) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND request_hash=?)',
          task.id,
          'state',
          part,
          body,
          task.id,
          task.request_hash,
        ),
      );
      try {
        await db.batch([insert, ...chunks]);
      } catch {
        const found = await get(task.id);
        if (
          found?.owner_id === task.owner_id &&
          found.request_hash === task.request_hash
        )
          return found;
        throw new TaskError('TASK_WRITE_FAILED', '任务未能入队，请重试。', 503);
      }
      const saved = await get(task.id);
      if (!saved)
        throw new TaskError(
          'TASK_BUSY',
          '这本手账已有任务，或待处理任务已达上限。请先接收结果或处理已有任务。',
          409,
        );
      return saved;
    },
    async claim(at = Date.now()) {
      await bind(
        `UPDATE background_tasks SET status='paused', error='服务中断，上一批是否已被模型处理无法确认。检查后可手动继续。',lease=NULL,lease_until=NULL,updated_at=? WHERE status IN ('running','pausing') AND lease_until < ?`,
        at,
        at,
      ).run();
      return bind(
        `UPDATE background_tasks SET status='running', lease=?, lease_until=?,updated_at=? WHERE id=(SELECT id FROM background_tasks WHERE status='queued' ORDER BY created_at,id LIMIT 1) AND NOT EXISTS(SELECT 1 FROM background_tasks WHERE status IN ('running','pausing')) RETURNING *`,
        uid(),
        at + TASK_LEASE_MS,
        at,
      ).first<TaskRecord>();
    },
    async progress(
      task: TaskRecord,
      state: unknown,
      result: unknown,
      status: TaskStatus,
    ) {
      const lease = task.lease!;
      const live = await get(task.id);
      if (
        !live ||
        live.lease !== lease ||
        !['running', 'pausing'].includes(live.status)
      )
        return false;
      const nextStatus =
        live.status === 'pausing' && status !== 'completed' ? 'paused' : status;
      await db.batch([
        bind(
          `DELETE FROM task_chunks WHERE task_id=? AND slot='state' AND EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND lease=? AND status IN ('running','pausing'))`,
          task.id,
          task.id,
          lease,
        ),
        ...insertChunks(task.id, 'state', state, lease),
        ...insertChunks(task.id, `result:${task.step + 1}`, result, lease),
        bind(
          `UPDATE background_tasks SET step=step+1,status=CASE WHEN status='pausing' AND ? <> 'completed' THEN 'paused' ELSE ? END,error=NULL,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease=? AND status IN ('running','pausing')`,
          nextStatus,
          nextStatus,
          Date.now(),
          task.id,
          lease,
        ),
      ]);
      return (await get(task.id))?.step === task.step + 1;
    },
    async fail(task: TaskRecord, message: string) {
      await bind(
        `UPDATE background_tasks SET status=CASE WHEN status='pausing' THEN 'paused' ELSE 'failed' END,error=?,lease=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease=? AND status IN ('running','pausing')`,
        message,
        Date.now(),
        task.id,
        task.lease,
      ).run();
    },
    async control(
      owner: string,
      id: string,
      action: 'pause' | 'resume' | 'cancel',
      resumeState?: unknown,
    ) {
      const task = await get(id);
      if (!task || task.owner_id !== owner)
        throw new TaskError('NOT_FOUND', '任务不存在。', 404);
      if (action === 'resume') {
        const writes =
          resumeState === undefined
            ? []
            : [
                bind(
                  "DELETE FROM task_chunks WHERE task_id=? AND slot='state' AND EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND owner_id=? AND status IN ('paused','failed'))",
                  id,
                  id,
                  owner,
                ),
                ...parts(resumeState).map((body, part) =>
                  bind(
                    "INSERT INTO task_chunks(task_id,slot,part,body) SELECT ?,'state',?,? WHERE EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND owner_id=? AND status IN ('paused','failed'))",
                    id,
                    part,
                    body,
                    id,
                    owner,
                  ),
                ),
              ];
        await db.batch([
          ...writes,
          bind(
            `UPDATE background_tasks SET status='queued',error=NULL,updated_at=? WHERE id=? AND owner_id=? AND status IN ('paused','failed')`,
            Date.now(),
            id,
            owner,
          ),
        ]);
      } else if (action === 'pause') {
        await bind(
          `UPDATE background_tasks SET status=CASE WHEN status='running' THEN 'pausing' ELSE 'paused' END,updated_at=? WHERE id=? AND owner_id=? AND status IN ('running','queued')`,
          Date.now(),
          id,
          owner,
        ).run();
      } else
        await db.batch([
          bind(
            `UPDATE background_tasks SET status='cancelled',lease=NULL,lease_until=NULL,acknowledged=step,error=NULL,updated_at=? WHERE id=? AND owner_id=?`,
            Date.now(),
            id,
            owner,
          ),
          bind('DELETE FROM task_chunks WHERE task_id=?', id),
        ]);
      return (await get(id))!;
    },
    async acknowledge(owner: string, id: string, step: number) {
      await db.batch([
        bind(
          'UPDATE background_tasks SET acknowledged=MAX(acknowledged,?) WHERE id=? AND owner_id=? AND step>=?',
          step,
          id,
          owner,
          step,
        ),
        bind(
          `DELETE FROM task_chunks WHERE task_id=? AND slot=? AND EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND owner_id=? AND acknowledged>=?)`,
          id,
          `result:${step}`,
          id,
          owner,
          step,
        ),
        bind(
          `DELETE FROM task_chunks WHERE task_id=? AND EXISTS(SELECT 1 FROM background_tasks WHERE id=? AND owner_id=? AND status='completed' AND acknowledged=step)`,
          id,
          id,
          owner,
        ),
      ]);
    },
  };
}
export type TaskRepository = ReturnType<typeof taskRepository>;
