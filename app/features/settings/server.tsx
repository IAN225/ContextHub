'use client';
import { useServerSettings } from './use-server-settings.ts';

import { ArrowLeft, Globe, LogOut, RotateCcw } from 'lucide-react';
import { Button } from '../../components/shared/button.tsx';
export function ServerPage() {
  const {
    status,
    origin,
    setOrigin,
    mode,
    setMode,
    terms,
    setTerms,
    busy,
    error,
    feedback,
    load,
    action,
    changingOrigin,
  } = useServerSettings();
  return (
    <main className="server-page">
      {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- Reload after login to avoid cached anonymous navigation. */}
      <a href="/" className="server-back">
        <ArrowLeft size={16} />
        返回工作区
      </a>
      <header className="server-heading">
        <Globe size={25} />
        <div>
          <h1>服务器访问</h1>
        </div>
      </header>
      {!status && <output>正在读取服务器状态…</output>}
      {status && !status.enabled && (
        <section className="server-card">
          <h2>当前是本地模式</h2>
          <p>
            服务器管理仅在服务器启动方式下启用，本机工作区和临时 MCP
            连接照常使用。
          </p>
          <p>部署步骤见仓库的服务器部署文档。</p>
        </section>
      )}
      {status?.enabled && !status.authenticated && (
        <section className="server-card">
          <p>请使用管理员账号登录。</p>
          {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- Reset expired account navigation. */}
          <a href="/login">登录</a>
        </section>
      )}
      {status?.authenticated && (
        <>
          <section className="server-card">
            <div className="server-card-head">
              <h2>访问方式</h2>
              <Button onClick={() => void action('logout')} disabled={busy}>
                <LogOut size={14} />
                退出登录
              </Button>
            </div>
            <label className="server-field">
              HTTPS 配置
              <select
                value={mode}
                disabled={busy || !!status.pending}
                onChange={(e) => setMode(e.target.value)}
              >
                <option value="automatic">自动申请与续期证书</option>
                <option value="external">已有 HTTPS 入口</option>
              </select>
            </label>
            <p>
              {mode === 'automatic'
                ? '将自有域名或可控制的免费子域名解析到服务器，并放通 80、443 端口。证书由服务器自动管理。'
                : '由已有反向代理或云平台管理证书，将 HTTPS 流量转发到本机 4080 端口，并保留访问域名与 HTTPS 协议标记。'}
            </p>
            <label className="server-field">
              访问域名
              <input
                value={origin}
                placeholder="hub.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={busy || !!status.pending}
                onChange={(e) => setOrigin(e.target.value)}
              />
              <small>填写域名，不包含端口或路径。</small>
            </label>
            {mode === 'automatic' && (
              <label className="server-check">
                <input
                  type="checkbox"
                  checked={terms}
                  onChange={(e) => setTerms(e.target.checked)}
                />
                同意{' '}
                <a
                  href="https://letsencrypt.org/repository/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Let’s Encrypt 订户协议
                </a>
                ，允许服务器申请与续期证书。
              </label>
            )}
            {changingOrigin && (
              <p className="callout warning">
                更换地址后需重新连接
                MCP。账号数据保存在此服务器；换地址后需要重新登录。
              </p>
            )}
            <Button
              primary
              disabled={
                busy ||
                !!status.pending ||
                !origin.trim() ||
                (mode === 'automatic' && !terms)
              }
              onClick={() =>
                void action('configure', {
                  mode,
                  origin: origin.trim(),
                  acceptAcmeTerms: terms,
                  confirmOriginChange: changingOrigin,
                })
              }
            >
              {status.pending
                ? '正在配置…'
                : changingOrigin
                  ? '确认并启用新地址'
                  : '检查并开启 HTTPS'}
            </Button>
          </section>
          <section className="server-card" aria-live="polite">
            <div className="server-card-head">
              <h2>连接状态</h2>
              <Button
                disabled={busy || !!status.pending || !status.access}
                onClick={() => void action('check')}
              >
                <RotateCcw size={14} />
                检查连接
              </Button>
            </div>
            {status.pending && (
              <output>
                {status.pending.phase} · {status.pending.origin}
              </output>
            )}
            {status.access ? (
              <dl className="server-status">
                <dt>访问地址</dt>
                <dd>
                  <a href={status.access.origin}>{status.access.origin}</a>
                </dd>
                <dt>证书</dt>
                <dd>{status.access.issuer || '等待验证'}</dd>
                <dt>到期时间</dt>
                <dd>
                  {status.access.expiresAt
                    ? new Date(status.access.expiresAt).toLocaleString()
                    : '等待验证'}
                </dd>
                <dt>自动续期</dt>
                <dd>
                  {status.access.mode === 'automatic'
                    ? '由服务器 Caddy 管理'
                    : '由外部 HTTPS 服务管理'}
                </dd>
                <dt>最近验证</dt>
                <dd>
                  {status.access.checkedAt
                    ? new Date(status.access.checkedAt).toLocaleString()
                    : '尚未验证，可点击检查连接'}
                </dd>
              </dl>
            ) : (
              !status.pending && <p>尚未配置 HTTPS，MCP 未启用。</p>
            )}
            {feedback && !status.error && (
              <output className="callout">{feedback}</output>
            )}
            {status.error && (
              <p role="alert" className="callout warning">
                {status.error}
              </p>
            )}
            {status.localSetup && status.access && (
              <p>
                地址已就绪，请打开上方 HTTPS 链接并登录。SSH
                本机入口可保留作维护使用。
              </p>
            )}
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="callout warning">
          {error}
          <Button onClick={() => void load()}>刷新状态</Button>
        </p>
      )}
    </main>
  );
}
