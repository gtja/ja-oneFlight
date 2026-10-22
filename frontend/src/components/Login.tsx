import { useState } from "react";
import { Radar, Send } from "lucide-react";
import { write } from "../api";
import { Button, Empty } from "./UI";

export type AuthOptions = {
  mode: "local" | "4a";
  accountsMode?: "local" | "4a";
  localLoginEnabled: boolean;
  transportMode?: "https" | "http-ip";
};
export type FourALoginContext = {
  view?: string;
  deviceId?: string;
  taskId?: string;
};
export function fourALoginUrl(context?: FourALoginContext): string {
  const query = new URLSearchParams();
  if (context?.view === "flight") {
    query.set("view", "flight");
    for (const key of ["deviceId", "taskId"] as const) {
      const value = context[key];
      if (value && value.length <= 128) query.set(key, value);
    }
  }
  return `/api/v1/auth/4a/start${query.size ? `?${query}` : ""}`;
}
export function authErrorMessage(code: string | null): string {
  return (
    (
      {
        INVALID_STATE: "登录回调已失效，请重新发起 4A 登录。",
        FOUR_A_SESSION_EXPIRED: "4A 登录已失效，请重新登录。",
        FOUR_A_LOGIN_REQUIRED: "请通过 4A 统一登录后继续。",
        FOUR_A_UNAVAILABLE: "4A 认证服务暂不可用，请稍后重试。",
        FOUR_A_PROFILE_INVALID: "4A 返回的身份数据暂不兼容，请联系平台管理员。",
        FOUR_A_ACCOUNT_DISABLED: "4A 账号已停用，请联系 4A 管理员。",
        PLATFORM_NOT_OPEN:
          "当前 4A 账号尚未开通一网统飞应用权限，请联系 4A 管理员。",
        ACCOUNT_DISABLED: "平台业务账号已停用，请联系平台管理员。",
        BINDING_CHANGED: "4A 账号信息已变化，请重新登录。",
        ACCOUNT_PROJECTION_CHANGED: "4A 账号信息已变化，请重新登录。",
      } as Record<string, string>
    )[code || ""] || (code ? "登录未完成，请重新登录或联系管理员。" : "")
  );
}

export default function Login({
  onSuccess,
  serviceError,
  options,
  optionsError,
  onRetry,
  notice,
  loginContext,
}: {
  onSuccess: () => void;
  serviceError?: string;
  options?: AuthOptions;
  optionsError?: Error | null;
  onRetry: () => void;
  notice?: string;
  loginContext?: FourALoginContext;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await write("/auth/login", { username, password });
      setPassword("");
      onSuccess();
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
  const sso = options?.mode === "4a";
  return (
    <div className="login-screen">
      <div className="login-brand">
        <img src="/logo.svg" alt="" />
        <span>一网统飞平台</span>
      </div>
      <div className="login-visual">
        <div className="radar-grid" />
        <div className="radar-circle c1" />
        <div className="radar-circle c2" />
        <div className="radar-circle c3" />
        <Radar size={64} />
        <h1>全域协同 · 统筹飞行</h1>
        <p>
          任务、资源与现场数据
          <br />
          在同一个工作台连接。
        </p>
        <div className="login-visual-footer">ONEFLIGHT · HANGZHOU</div>
      </div>
      <main className="login-form">
        <small className="eyebrow">ONEFLIGHT OPERATIONS</small>
        <h2>登录工作台</h2>
        {notice && (
          <p className="auth-notice" role="status">
            {notice}
          </p>
        )}
        {!options || optionsError ? (
          <>
            <Empty
              loading={!optionsError}
              error={optionsError}
              description="正在读取登录方式…"
            />
            {optionsError && (
              <Button onClick={onRetry}>重新读取登录配置</Button>
            )}
          </>
        ) : (
          <>
            <p>
              {sso
                ? "使用 4A 账号统一登录，平台业务权限由平台管理员配置。"
                : "使用本地账号进入你的业务范围"}
            </p>
            {sso && (
              <a
                className="button primary sso-login"
                href={fourALoginUrl(loginContext)}
              >
                4A 统一登录 <Send size={14} />
              </a>
            )}
            {!sso && options.localLoginEnabled && (
              <form onSubmit={login}>
                <label className="field">
                  <span>登录账号</span>
                  <input
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    placeholder="请输入账号"
                  />
                </label>
                <label className="field">
                  <span>密码</span>
                  <input
                    autoComplete="current-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    placeholder="请输入密码"
                  />
                </label>
                {error && <p className="form-error">{error}</p>}
                <Button primary disabled={busy} type="submit">
                  {busy ? "正在登录…" : "进入工作台"} <Send size={14} />
                </Button>
              </form>
            )}
            {serviceError && (
              <p className="form-error">服务连接异常：{serviceError}</p>
            )}
            <small className="login-help">
              {sso
                ? "登录后可直接进入已获授权的飞控，无需另建平台账号。"
                : "首次管理员账号由部署配置初始化，其他账号由管理员创建。"}
            </small>
          </>
        )}
      </main>
      <footer className="login-footer">
        一网统飞平台 · 统一受理 · 资源协同 · 执行留痕
      </footer>
    </div>
  );
}
