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
import {
  generationConfig,
  type SummaryProbe,
  type SummaryConnection,
} from '@/lib/summary/contracts';
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
    accept,
  } = useSummaryConnection();
  // Credentials deliberately never enter usePersistent, drafts or HubState.
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current || !p.ready || !connection) return;
    initialized.current = true;
    if (connection.ready && (!d.baseUrl || !d.model))
      setD((current) => ({
        ...current,
        baseUrl: current.baseUrl || connection.baseUrl,
        model: current.model || connection.model,
        protocol: current.baseUrl ? current.protocol : connection.protocol,
      }));
  }, [p.ready, connection, d.baseUrl, d.model, setD]);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function saveConnection() {
    if (!connection?.editable)
      throw new Error('请先启动新版本地服务并重新读取连接。');
    if (
      connection.ready &&
      !apiKey.trim() &&
      d.baseUrl?.trim().replace(/\/+$/, '') === connection.baseUrl &&
      d.model?.trim() === connection.model &&
      d.protocol === connection.protocol
    )
      return connection;
    const saved = await summaryRequest<SummaryConnection>('connection', {
      baseUrl: d.baseUrl?.trim() || '',
      model: d.model?.trim() || '',
      protocol: d.protocol || 'openai',
      apiKey,
      revision: connection.revision || '',
    });
    setApiKey('');
    accept(saved);
    return saved;
  }
  async function save() {
    if (saving || testing) return;
    setSaving(true);
    setError('');
    try {
      const connection = await saveConnection();
      const config = {
        ...d,
        baseUrl: connection.baseUrl,
        model: connection.model,
        protocol: connection.protocol,
      };
      const saved = await p.commitWith(config, (entry) =>
        onCommit(
          {
            type: 'summary/config',
            patch: { ...config, configured: true, modelEnabled: true },
          },
          entry,
        ),
      );
      if (saved) onClose();
      else setError('模型连接已保存，但手账参数未能保存，请重试。');
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : '模型连接未能保存。',
      );
    } finally {
      setSaving(false);
    }
  }
  async function probe() {
    if (testing) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setError('');
    try {
      await saveConnection();
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
      description="Key 保存在本机服务中，不进入手账备份。提示词与预算保存在当前手账。"
      onClose={() => {
        if (!saving) onClose();
      }}
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
                    thinking: connection.thinking ?? d.thinking,
                  });
              }}
            >
              使用本地连接
            </Button>
            <Button disabled={saving || testing} onClick={refresh}>
              重新读取连接
            </Button>
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
                onChange={(protocol) =>
                  setD({ ...d, protocol, outputField: '自动' })
                }
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
              API Key
              <input
                type="password"
                name="summary-api-key"
                autoComplete="new-password"
                spellCheck={false}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  connection?.keyConfigured
                    ? '已配置，留空沿用；填写则更换'
                    : '填写对应服务的 API Key'
                }
                disabled={saving || testing}
              />
              <small>
                {connection?.keyConfigured ? '已有 Key 不会回显。' : ''}
                点击保存或测试后才保存 Key。
              </small>
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
              {connection?.thinking ? (
                <input
                  value={`${connection.thinking}（本地配置固定）`}
                  readOnly
                />
              ) : (
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
              )}
            </label>
          </div>
          <p className="callout">
            模型连接由本机服务上的所有手账共用，保存后立即生效。更换地址或协议时请填写对应
            Key；进行中的旧任务会在下一批前核对连接。
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
            测试会发送一条简短请求，可能产生费用。Responses
            思考检测依据本次响应的思考 token
            数及思考输出；缺少信息时显示无法确认。最大输出上限和具体思考强度仍需单独验证。
          </p>
          <Button
            disabled={
              testing ||
              saving ||
              !p.ready ||
              !connection?.editable ||
              !d.baseUrl?.trim() ||
              !d.model?.trim()
            }
            onClick={() => {
              void probe();
            }}
          >
            <FlaskConical size={15} />
            {testing ? '正在测试模型…' : '保存连接并测试'}
          </Button>
          {probes.map((r, i) => (
            <div className="probe-row" key={i}>
              <code>{r.field}</code>
              <span
                className={
                  ['明确报错', '与设置不符', '无法确认是否生效'].includes(
                    r.status,
                  )
                    ? 'amber'
                    : 'mint'
                }
              >
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
        <Button disabled={saving} onClick={onClose}>
          保留参数草稿
        </Button>
        <Button
          primary
          disabled={
            !p.ready ||
            p.busy ||
            saving ||
            testing ||
            !d.model?.trim() ||
            !d.baseUrl?.trim() ||
            !connection?.editable
          }
          onClick={() => {
            void save();
          }}
        >
          <Check size={15} />
          {saving ? '正在保存…' : '保存摘要配置'}
        </Button>
      </div>
    </Modal>
  );
}
