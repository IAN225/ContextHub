'use client';
import { useEffect, useRef, useState } from 'react';
import { type Config, type Workspace } from '../../lib/core/model.ts';
import { usePersistent } from '../../lib/store.ts';
import { summaryRequest } from '../../lib/summary/client.ts';
import {
  generationConfig,
  type SummaryConnection,
  type SummaryProbe,
} from '../../lib/summary/contracts.ts';
import {
  defaultSummaryPrompt,
  defaultSummarySystem,
} from '../../lib/summary/prompts.ts';
import { useSummaryConnection } from '../../lib/summary/use-connection.ts';
import type { CommitWorkspaceCommand } from '../../lib/use-hub.ts';
export function useModelSettings({
  w,
  onCommit,
  onClose,
}: {
  w: Workspace;
  onCommit: CommitWorkspaceCommand;
  onClose: () => void;
}) {
  const engine = w.summaryEngine ?? 'custom';
  const suffix = engine === 'custom' ? w.id : w.id + '-reme';
  const [d, setD, p] = usePersistent<Config>(`model-draft-${suffix}`, {
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
  const [probes, setProbes, probeState] = usePersistent<SummaryProbe[]>(
    `model-probes-v2-${suffix}`,
    [],
  );
  const [tab, setTab] = useState('provider');
  const {
    connection,
    error: connectionError,
    refresh,
    accept,
  } = useSummaryConnection(engine);
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
    const saved = await summaryRequest<SummaryConnection>(
      'connection?engine=' + engine,
      {
        baseUrl: d.baseUrl?.trim() || '',
        model: d.model?.trim() || '',
        protocol: d.protocol || 'openai',
        apiKey,
        revision: connection.revision || '',
      },
    );
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
      else setError('模型连接已保存，但工作区参数未能保存，请重试。');
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
        'probe?engine=' + engine,
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
  return {
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
  };
}
