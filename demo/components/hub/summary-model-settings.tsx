'use client';
import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Check } from 'lucide-react';
import { Button, Modal, Composer, Picker, SaveStatus } from './shared';
import { TextEditor } from './editors';
import { usePersistent } from '@/lib/store';
import type { CommitWorkspaceCommand } from '@/lib/use-hub';
import type { Workspace, Config } from '@/lib/domain';
import {
  defaultSummaryPrompt,
  defaultSummarySystem,
} from '@/lib/summary/prompts';
import { generationConfig, type SummaryProbe } from '@/lib/summary/contracts';
import { summaryRequest } from '@/lib/summary/client';
import { useSummaryConnection } from '@/lib/summary/use-connection';

export function ModelSettings({
  w,
  onCommit,
  onClose,
}: {
  w: Workspace;
  onCommit: CommitWorkspaceCommand;
  onClose: () => void;
}) {
  const [d, setD, p] = usePersistent<Config>(`model-draft-${w.id}`, {
    ...w.config,
    provider: w.config.provider ?? 'OpenAI',
    baseUrl: w.config.baseUrl ?? '',
    model: w.config.model ?? '',
    protocol: w.config.protocol ?? 'openai',
    system: w.config.system ?? defaultSummarySystem,
    promptBlocks: w.config.promptBlocks ?? defaultSummaryPrompt,
    budget: w.config.budget ?? 32000,
    maxOutput: w.config.maxOutput ?? 4000,
    thinking: w.config.thinking ?? '未设置',
    outputField: w.config.outputField ?? '自动',
  });
  const [probes, setProbes] = usePersistent<SummaryProbe[]>(
    `model-probes-v2-${w.id}`,
    [],
  );
  const [tab, setTab] = useState('provider');
  const {
    connection,
    error: connectionError,
    refresh,
  } = useSummaryConnection();
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function probe() {
    if (testing) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setError('');
    try {
      const response = await summaryRequest<{ probes: SummaryProbe[] }>(
        'probe',
        {
          system: 'This is a connection test. Reply only with OK.',
          user: 'Reply OK.',
          config: generationConfig(d),
        },
        controller.signal,
      );
      if (!controller.signal.aborted) setProbes(response.probes);
    } catch (failure) {
      if (!controller.signal.aborted) {
        const detail =
          failure instanceof Error ? failure.message : '模型连接测试失败。';
        setError(detail);
        setProbes([{ field: '本次请求', status: '明确报错', detail }]);
      }
    } finally {
      if (!controller.signal.aborted) setTesting(false);
    }
  }
  return (
    <Modal
      title="摘要模型与提示词"
      description="提示词和参数保存在此浏览器，Key 仅由本地服务读取。"
      onClose={onClose}
    >
      <div className="action-row">
        <Button primary={tab === 'provider'} onClick={() => setTab('provider')}>
          模型与预算
        </Button>
        <Button primary={tab === 'prompt'} onClick={() => setTab('prompt')}>
          提示词编排
        </Button>
        <Button
          primary={tab === 'capability'}
          onClick={() => setTab('capability')}
        >
          能力探测记录
        </Button>
      </div>
      {tab === 'provider' ? (
        <div className="form-stack">
          <p className={`callout${connection?.ready ? '' : ' warning'}`}>
            {connectionError || connection?.message || '正在检查本地摘要连接…'}
          </p>
          <div className="action-row">
            <Button
              disabled={!connection?.ready || !p.ready}
              onClick={() => {
                if (connection)
                  setD({
                    ...d,
                    baseUrl: connection.baseUrl,
                    model: connection.model,
                    protocol: connection.protocol,
                    provider:
                      connection.protocol === 'anthropic'
                        ? 'Anthropic'
                        : connection.protocol === 'gemini'
                          ? 'Gemini'
                          : '自定义 / 中转',
                    outputField: '自动',
                  });
              }}
            >
              使用本地连接
            </Button>
            <Button onClick={refresh}>重新读取连接</Button>
          </div>
          <div className="form-grid">
            <label className="field">
              提供方适配
              <Picker
                label="提供方"
                value={d.provider!}
                onChange={(provider) => setD({ ...d, provider })}
                options={['OpenAI', 'Anthropic', 'Gemini', '自定义 / 中转'].map(
                  (v) => ({ value: v, label: v }),
                )}
              />
            </label>
            <label className="field">
              实际请求协议
              <Picker
                label="请求协议"
                value={d.protocol!}
                onChange={(protocol) => setD({ ...d, protocol })}
                options={[
                  { value: 'openai', label: 'OpenAI 兼容' },
                  { value: 'responses', label: 'OpenAI Responses' },
                  { value: 'anthropic', label: 'Anthropic Messages' },
                  { value: 'gemini', label: 'Gemini GenerateContent' },
                ]}
              />
            </label>
            <label className="field">
              自定义 Base URL
              <input
                value={d.baseUrl ?? ''}
                onChange={(e) => setD({ ...d, baseUrl: e.target.value })}
                placeholder="https://your-provider.example/v1"
              />
            </label>
            <label className="field">
              模型名称
              <input
                value={d.model ?? ''}
                onChange={(e) => setD({ ...d, model: e.target.value })}
                placeholder="模型名称，或使用本地连接中的默认值"
              />
            </label>
            <label className="field">
              上下文总预算（token）
              <input
                type="number"
                min={2048}
                max={2000000}
                value={d.budget}
                onChange={(e) => setD({ ...d, budget: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              最大输出（token）
              <input
                type="number"
                min={256}
                max={64000}
                value={d.maxOutput}
                onChange={(e) =>
                  setD({
                    ...d,
                    maxOutput: Number(e.target.value),
                  })
                }
              />
            </label>
            <label className="field">
              最大输出字段
              <Picker
                label="最大输出字段"
                value={d.outputField!}
                onChange={(outputField) => setD({ ...d, outputField })}
                options={[
                  '自动',
                  'max_tokens',
                  'max_completion_tokens',
                  'max_output_tokens',
                  'maxOutputTokens',
                ].map((v) => ({ value: v, label: v }))}
              />
            </label>
            <label className="field">
              思考设置
              <Picker
                label="思考设置"
                value={d.thinking!}
                onChange={(thinking) => setD({ ...d, thinking })}
                options={[
                  '未设置',
                  '关闭',
                  '开启',
                  'low',
                  'medium',
                  'high',
                ].map((v) => ({ value: v, label: v }))}
              />
            </label>
          </div>
          <p className="callout">
            本地凭据绑定本地文件中的地址和协议。更换服务时先更新本地文件并重启，再读取连接；模型名称与生成参数可在此调整。
          </p>
          <p className="inline-note">
            总预算包括提示词、上一份摘要、本批原文、输出预留和安全余量。使用保守估算，超限时减少完整轮次数，不截断消息。
          </p>
        </div>
      ) : tab === 'prompt' ? (
        <div className="form-stack">
          <TextEditor
            label="SYSTEM PROMPT"
            value={d.system ?? ''}
            onChange={(system) => setD({ ...d, system })}
          />
          <div className="surface-head">
            <h2>User Prompt 编排</h2>
            <small>原文引用在压缩中代表「下一批完整轮次」</small>
          </div>
          <Composer
            blocks={d.promptBlocks ?? defaultSummaryPrompt}
            onChange={(promptBlocks) => setD({ ...d, promptBlocks })}
          />
        </div>
      ) : (
        <div className="form-stack">
          <p className="callout warning">
            字段被接受 ≠
            能力已经生效。测试会向当前模型发送一条简短请求，可能产生费用；成功只表明本次参数被接受，不保证思考强度生效。
          </p>
          <Button
            disabled={testing || !p.ready || !connection?.ready}
            onClick={() => {
              void probe();
            }}
          >
            <FlaskConical size={15} />
            {testing ? '正在测试模型…' : '测试当前模型连接'}
          </Button>
          {probes.map((r, i) => (
            <div className="probe-row" key={i}>
              <code>{r.field}</code>
              <span className={r.status === '明确报错' ? 'amber' : 'mint'}>
                {r.status}
              </span>
              <p>{r.detail}</p>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <span className="save-caption">
          <SaveStatus state={p}>
            {p.saved ? '✓ 配置草稿已保存' : '正在保存…'}
          </SaveStatus>
        </span>
        <Button onClick={onClose}>保留草稿</Button>
        <Button
          primary
          disabled={
            !p.ready ||
            p.busy ||
            testing ||
            !d.model?.trim() ||
            !connection?.ready
          }
          onClick={async () => {
            const saved = await p.commitWith(d, (entry) =>
              onCommit(
                {
                  type: 'summary/config',
                  patch: { ...d, configured: true, modelEnabled: true },
                },
                entry,
              ),
            );
            if (saved) onClose();
          }}
        >
          <Check size={15} />
          保存摘要配置
        </Button>
      </div>
    </Modal>
  );
}
