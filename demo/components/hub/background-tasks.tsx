'use client';
import { useState } from 'react';
import { ListTodo, Pause, Play, X } from 'lucide-react';
import { Button, CopyButton, Modal, formatDate } from './shared';
import { useTaskQueue } from '@/lib/tasks/use-background-tasks';
import { taskLabels, type BackgroundTask } from '@/lib/tasks/contracts';
export function BackgroundTaskButton({ onClick }: { onClick: () => void }) {
  const queue = useTaskQueue();
  const count =
    queue?.tasks.filter(
      (t) =>
        ['queued', 'running', 'pausing'].includes(t.status) ||
        t.step > t.acknowledged,
    ).length ?? 0;
  return (
    <Button onClick={onClick}>
      <ListTodo size={16} />
      后台任务{count ? ` ${count}` : ''}
    </Button>
  );
}
export function BackgroundTaskManager({ onClose }: { onClose: () => void }) {
  const queue = useTaskQueue();
  const [error, setError] = useState('');
  const [cancel, setCancel] = useState<BackgroundTask | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '任务操作失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="后台任务"
      description="关闭网页后，本机服务仍可继续处理。服务停止或电脑休眠时会中断；未完成的模型请求需要检查后手动继续。"
      onClose={onClose}
    >
      {(error || queue?.error) && (
        <p role="alert" className="callout warning">
          {error || queue?.error}
        </p>
      )}
      {!queue?.ready && (
        <p className="callout warning">
          后台服务尚未就绪，请使用本地启动脚本运行应用。
        </p>
      )}
      <div className="background-task-list">
        {!queue?.tasks.length && (
          <p className="inline-note">
            还没有后台任务。摘要压缩和远程附件获取会出现在这里。
          </p>
        )}
        {queue?.tasks
          .filter((t) => t.status !== 'cancelled')
          .map((task) => (
            <section key={task.id} className="background-task-row">
              <div>
                <strong>{task.title}</strong>
                <span className="pill">{taskLabels[task.status]}</span>
              </div>
              <p>
                {task.kind === 'summary'
                  ? `${task.step} 个检查点`
                  : task.kind === 'workbench'
                    ? `${task.step} 份候选`
                    : `${task.step} / ${task.total} 个附件`}{' '}
                ·{' '}
                {task.step > task.acknowledged
                  ? '结果待接收'
                  : task.step
                    ? '结果已接收'
                    : '等待结果'}{' '}
                · {formatDate(new Date(task.updated_at).toISOString())}
              </p>
              {(task.error || queue.problems[task.id]) && (
                <p className="callout warning">
                  {queue.problems[task.id] || task.error}
                </p>
              )}
              {queue.candidates[task.id] && (
                <label className="field">
                  未应用的摘要
                  <textarea
                    rows={5}
                    readOnly
                    value={queue.candidates[task.id].summary.text}
                  />
                  <CopyButton text={queue.candidates[task.id].summary.text} />
                </label>
              )}
              <div className="action-row">
                {['queued', 'running'].includes(task.status) && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void run(() => queue.control(task.id, 'pause'));
                    }}
                  >
                    <Pause size={13} />
                    本批后暂停
                  </Button>
                )}
                {['paused', 'failed'].includes(task.status) && (
                  <Button
                    disabled={busy || task.step > task.acknowledged}
                    onClick={() => {
                      void run(() => queue.control(task.id, 'resume'));
                    }}
                  >
                    <Play size={13} />
                    继续
                  </Button>
                )}
                {queue.problems[task.id] && (
                  <Button
                    disabled={busy}
                    onClick={() => queue.retryReceive(task.id)}
                  >
                    重试接收
                  </Button>
                )}
                {(task.status !== 'completed' ||
                  task.step > task.acknowledged) && (
                  <Button disabled={busy} onClick={() => setCancel(task)}>
                    <X size={13} />
                    取消任务
                  </Button>
                )}
              </div>
            </section>
          ))}
      </div>
      {cancel && (
        <div className="callout warning">
          <p>
            取消“{cancel.title}”并丢弃尚未接收的结果？已保存到手账的内容会保留。
          </p>
          <div className="action-row">
            <Button disabled={busy} onClick={() => setCancel(null)}>
              保留任务
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  await queue?.control(cancel.id, 'cancel');
                  setCancel(null);
                });
              }}
            >
              确认取消
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
