"use client";
/* oxlint-disable nextjs/no-html-link-for-pages -- Account navigation must discard stale session state. */
import { useEffect, useState } from "react";
import { accountAction, getAccountStatus, type AccountStatus } from "@/lib/account/client";
import "../login/login.css";
export default function RegisterPage() {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  useEffect(() => {
    void getAccountStatus()
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="login-page">
      <section className="login-card">
        <span className="login-eyebrow">CONTEXT HUB</span>
        <h1>申请账号</h1>
        {!status && <output>正在读取注册状态…</output>}
        {status && !status.registrationOpen && <p>当前未开放注册申请，请联系管理员。</p>}
        {done ? (
          <output>申请已提交，等待管理员审批。审批通过后即可使用刚设置的用户名和密码登录。</output>
        ) : (
          status?.registrationOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                void accountAction("register", { username: username.trim(), password })
                  .then(() => {
                    setDone(true);
                    setPassword("");
                    setConfirmation("");
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <p>账号需经管理员审批后才能使用。</p>
              <label>
                用户名
                <input
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,39}"
                  minLength={3}
                  maxLength={40}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <small>3–40 位字母、数字、点、下划线或连字符。</small>
              <label>
                密码
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={12}
                  maxLength={256}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label>
                确认密码
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  maxLength={256}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={busy || password.length < 12 || password !== confirmation}
              >
                {busy ? "正在提交…" : "提交注册申请"}
              </button>
            </form>
          )
        )}
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        <a href="/login">返回登录</a>
      </section>
    </main>
  );
}
