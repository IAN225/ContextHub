'use client';
import { useEffect, useState } from 'react';
import { Copy, KeyRound, RefreshCw } from 'lucide-react';
import { Button, Picker } from '../shared';
import { importRequest } from '@/lib/imports/client';
import { protocols } from '@/lib/imports/protocols';

export function DeliverySettings({
  protocol,
  onProtocol,
  onActivate,
}: {
  protocol: string;
  onProtocol: (protocol: string) => void;
  onActivate: () => Promise<boolean>;
}) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    importRequest<{ enabled: boolean }>(
      'delivery',
      undefined,
      controller.signal,
    )
      .then(async (r) => {
        setEnabled(r.enabled);
        if (r.enabled && !(await onActivate()))
          setError('自动收件设置尚未保存，请刷新后重试。');
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setOrigin(window.location.origin);
          setBusy(false);
        }
      });
    return () => controller.abort();
  }, [onActivate]);
  async function configure(action: 'rotate' | 'revoke') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await importRequest<{ enabled: boolean; key?: string }>(
        'delivery',
        { action },
      );
      setEnabled(result.enabled);
      setKey(result.key || '');
      if (!(await onActivate()))
        setError('Key 已生效，但自动收件设置未保存，请刷新后重新打开此页。');
      window.dispatchEvent(new Event('context-hub-delivery-refresh'));
      if (action === 'revoke')
        setNotice('旧 Key 已失效，已投递的内容仍会接收。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('已复制');
    } catch {
      setError('未能写入剪贴板，请选中内容手动复制。');
    }
  }
  const selected = protocols.find((p) => p.id === protocol) ?? protocols[0];
  return (
    <div className="form-stack">
      <label className="field">
        客户端协议
        <Picker
          label="投递协议"
          value={selected.id}
          onChange={onProtocol}
          options={protocols.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      <div className="delivery-details">
        <span className="muted-label">Base URL</span>
        <code className="inline-code">{origin}/v1</code>
        <Button
          onClick={() => {
            void copy(`${origin}/v1`);
          }}
        >
          <Copy size={14} />
          复制 Base URL
        </Button>
        <span className="muted-label">完整投递地址</span>
        <code className="inline-code">
          {origin}
          {selected.path}
        </code>
        <p className="inline-note">
          模型名填写
          context-hub。客户端向这里发消息时，请求携带的上下文会进入收件箱。此接口只收录对话，返回收件回执。
        </p>
        <div className="action-row">
          <Button
            disabled={busy}
            onClick={() => {
              void configure('rotate');
            }}
          >
            <KeyRound size={14} />
            {enabled ? '重新生成投递 Key' : '启用并生成投递 Key'}
          </Button>
          {enabled && (
            <Button
              disabled={busy}
              onClick={() => {
                void configure('revoke');
              }}
            >
              吊销 Key
            </Button>
          )}
        </div>
        {key && (
          <>
            <code className="inline-code import-secret" aria-label="投递 Key">
              {key}
            </code>
            <Button
              onClick={() => {
                void copy(key);
              }}
            >
              <Copy size={14} />
              复制 Key
            </Button>
            <p className="inline-note">
              Key 只在本次生成后显示，请保存到客户端；重新生成会使旧 Key 失效。
            </p>
          </>
        )}
        {enabled && !key && (
          <p className="inline-note">
            投递已启用。若忘记 Key，可重新生成后更新客户端配置。
          </p>
        )}
      </div>
      <p className="inline-note">
        本机客户端可直接连接。其他设备需要能访问此服务的地址。服务运行期间，即使页面关闭也会保留待接收内容；打开此浏览器后自动收取。
      </p>
      <Button
        disabled={!origin}
        onClick={() => {
          window.dispatchEvent(new Event('context-hub-delivery-refresh'));
          setNotice('已请求检查新收件');
        }}
      >
        <RefreshCw size={14} />
        检查新收件
      </Button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="inline-note">{notice}</output>}
    </div>
  );
}
