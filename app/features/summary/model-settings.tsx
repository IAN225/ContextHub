'use client';
import { Check, FlaskConical } from 'lucide-react';
import { Button } from '../../components/shared/button.tsx';
import { Modal } from '../../components/shared/modal.tsx';
import {
  DraftBoundary,
  SaveStatus,
} from '../../components/shared/persistence-status.tsx';
import { Picker } from '../../components/shared/picker.tsx';
import { Composer } from '../../components/shared/prompt-composer.tsx';
import { TextEditor } from '../../components/shared/text-editor.tsx';
import { cloudMode } from '../../lib/account/client.ts';
import { type WorkspaceContext } from '../../lib/core/model.ts';
import { engineLabels } from '../../lib/summary/engines.ts';
import { defaultSummaryPrompt } from '../../lib/summary/prompts.ts';
import type { CommitWorkspaceCommand } from '../../lib/use-hub.ts';
import { useModelSettings } from './use-model-settings.ts';

export function ModelSettings({
  w,
  onCommit,
  onRefresh,
  onClose,
}: {
  w: WorkspaceContext;
  onCommit: CommitWorkspaceCommand;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const {
    engine,
    d,
    setD,
    p,
    probes,
    probeState,
    tab,
    setTab,
    connection,
    connectionError,
    refresh,
    apiKey,
    setApiKey,
    saving,
    testing,
    error,
    save,
    probe,
  } = useModelSettings({
    w,
    onCommit,
    onRefresh,
    onClose,
  });
  return (
    <Modal
      title={engineLabels[engine] + '设置'}
      description={
        cloudMode()
          ? 'API Key 不包含在导出备份中。模型接口需使用公网 HTTPS（443 端口）。'
          : 'API Key 不包含在导出备份中。'
      }
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <DraftBoundary state={p}>
        <DraftBoundary state={probeState}>
          <div className="action-row">
            <Button
              primary={tab === 'provider'}
              onClick={() => setTab('provider')}
            >
              模型与预算
            </Button>
            {engine === 'custom' && (
              <Button
                primary={tab === 'prompt'}
                onClick={() => setTab('prompt')}
              >
                提示词编排
              </Button>
            )}
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
                {connectionError ||
                  connection?.message ||
                  '正在检查本地摘要连接…'}
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
                  使用已保存连接
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
                    options={[
                      'OpenAI',
                      'Anthropic',
                      'Gemini',
                      '自定义 / 中转',
                    ].map((v) => ({ value: v, label: v }))}
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
                    placeholder="模型名称，或使用已保存连接中的默认值"
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
                    onChange={(e) =>
                      setD({ ...d, budget: Number(e.target.value) })
                    }
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
                      value={`${connection.thinking}（服务配置固定）`}
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
                {cloudMode()
                  ? '此连接仅供当前账号的同一压缩方案使用。保存后立即生效。更换地址或协议时请填写对应'
                  : '此连接仅供本机的同一压缩方案使用，保存后立即生效。更换地址或协议时请填写对应'}
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
        </DraftBoundary>
      </DraftBoundary>
    </Modal>
  );
}
