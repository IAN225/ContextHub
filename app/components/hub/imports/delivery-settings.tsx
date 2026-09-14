'use client';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CopyButton, Picker } from '../shared';
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
        setError('密钥已生效，设置保存失败，请刷新重试。');
      window.dispatchEvent(new Event('context-hub-delivery-refresh'));
      if (action === 'revoke') setNotice('密钥已吊销。');
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  const selected = protocols.find((p) => p.id === protocol) ?? protocols[0];
  return (
    <div className="form-stack delivery-form">
      <div className="field">
        <span>Base URL</span>
        <div className="delivery-code">
          <code>{origin}/v1</code>
          <CopyButton text={origin + '/v1'} iconOnly label="复制 Base URL" />
        </div>
      </div>
      <label className="field">
        客户端协议
        <Picker
          label="投递协议"
          value={selected.id}
          onChange={onProtocol}
          options={protocols.map((p) => ({ value: p.id, label: p.label }))}
        />
      </label>
      <div className="field">
        <span>完整投递地址</span>
        <div className="delivery-code">
          <code>
            {origin}
            {selected.path}
          </code>
          <CopyButton
            text={origin + selected.path}
            iconOnly
            label="复制完整投递地址"
          />
        </div>
      </div>
      <div className="field">
        <span>投递密钥</span>
        <div className="delivery-key-row">
          {key ? (
            <div className="delivery-code">
              <code className="import-secret">{key}</code>
              <CopyButton text={key} iconOnly label="复制投递密钥" />
            </div>
          ) : (
            <button
              type="button"
              className="delivery-key-create"
              disabled={busy}
              aria-label={enabled ? '重新生成投递密钥' : '生成投递密钥'}
              onClick={() => void configure('rotate')}
            >
              <Plus size={20} />
              {enabled && <span>重新生成</span>}
            </button>
          )}
          <button
            type="button"
            className="delivery-key-delete"
            disabled={busy || !enabled}
            aria-label="吊销投递密钥"
            title="吊销投递密钥"
            onClick={() => void configure('revoke')}
          >
            <Trash2 size={18} />
          </button>
        </div>
        {key && (
          <small className="field-help">密钥仅显示一次，请保存到客户端。</small>
        )}
        {enabled && !key && (
          <small className="field-help">
            已有密钥正在使用，重新生成将替换旧密钥。
          </small>
        )}
      </div>
      <p className="inline-note">
        模型名：<code>context-hub</code>
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="inline-note">{notice}</output>}
    </div>
  );
}
