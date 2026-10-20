import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Boxes,
  BrainCircuit,
  ChevronDown,
  Compass,
  FlaskConical,
  Globe2,
  LayoutDashboard,
  LogOut,
  Maximize,
  Radar,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { api, write, type CurrentUser } from "./api";
import type { Navigate } from "./navigation";
import { ROLE_LABELS } from "./domain";
import { FeedbackContext, UserContext } from "./context";
import { Button, Empty, Modal } from "./components/UI";
import Overview from "./pages/Overview";
import CommandBoard from "./pages/CommandBoard";
import Tasks from "./pages/Tasks";
import Flight from "./pages/Flight";
import Services from "./pages/Services";
import Resources from "./pages/Resources";
import Algorithms from "./pages/Algorithms";
import Scenes from "./pages/Scenes";
import Settings from "./pages/Settings";
const navigation = [
  { id: "overview", label: "态势感知", icon: LayoutDashboard },
  { id: "dispatch", label: "任务调度", icon: Send },
  { id: "flight", label: "飞行管控", icon: Compass },
  { id: "services", label: "飞行服务", icon: FileIcon },
  { id: "resources", label: "资源管理", icon: Boxes },
  { id: "algorithms", label: "飞行算法", icon: FlaskConical },
  { id: "scenes", label: "场景应用", icon: Globe2 },
];
function FileIcon({ size = 18 }: { size?: number }) {
  return <ShieldCheck size={size} />;
}
function Login({
  onSuccess,
  serviceError,
}: {
  onSuccess: () => void;
  serviceError?: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await write("/auth/login", { username, password });
      setPassword("");
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }
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
        <p>使用本地账号进入你的业务范围</p>
        <form onSubmit={login}>
          <label className="field">
            <span>登录账号</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
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
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="请输入密码"
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          {serviceError && !serviceError.includes("登录") && (
            <p className="form-error">服务连接异常：{serviceError}</p>
          )}
          <Button primary disabled={busy} type="submit">
            {busy ? "正在登录…" : "进入工作台"} <Send size={14} />
          </Button>
        </form>
        <small className="login-help">
          首次管理员账号由部署配置初始化，其他账号由管理员创建。
        </small>
      </main>
      <footer className="login-footer">
        一网统飞平台 · 统一受理 · 资源协同 · 执行留痕
      </footer>
    </div>
  );
}
export default function App() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["current-user"],
    queryFn: () => api<CurrentUser>("/auth/me"),
    retry: false,
    staleTime: 60_000,
  });
  const [settings, setSettings] = useState(false);
  const [settingsUserId, setSettingsUserId] = useState<string>();
  const [settingsTab, setSettingsTab] = useState<string>();
  const [about, setAbout] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [menu, setMenu] = useState(false);
  const [board, setBoard] = useState(false);
  const [toast, setToast] = useState("");
  const selected = params.get("view") || "overview";
  const view = navigation.some((n) => n.id === selected)
    ? selected
    : "overview";
  useEffect(() => {
    if (!board) return;
    const exitBoard = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector('[role="dialog"]')
      )
        setBoard(false);
    };
    window.addEventListener("keydown", exitBoard);
    return () => window.removeEventListener("keydown", exitBoard);
  }, [board]);
  useEffect(() => setBoard(false), [selected]);
  const navigate: Navigate = (v, context = {}) => {
    if (v === "settings") {
      setSettingsUserId(context.userId);
      setSettingsTab("users");
      setSettings(true);
      setBoard(false);
      return;
    }
    const next: Record<string, string> = { view: v };
    if (context.deviceId) next.deviceId = context.deviceId;
    if (context.taskId) next.taskId = context.taskId;
    if (context.planId) next.planId = context.planId;
    setParams(next);
    setBoard(false);
  };
  const feedback = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4500);
  };
  if (me.isPending)
    return (
      <div className="boot-screen">
        <img src="/logo.svg" alt="" />
        <Empty loading />
      </div>
    );
  if (!me.data)
    return (
      <Login
        onSuccess={() => {
          queryClient.removeQueries({
            predicate: (q) => q.queryKey[0] !== "current-user",
          });
          void queryClient.invalidateQueries({ queryKey: ["current-user"] });
        }}
        serviceError={
          me.error && "status" in me.error && me.error.status !== 401
            ? me.error.message
            : undefined
        }
      />
    );
  const user = me.data;
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      queryClient.removeQueries({
        predicate: (q) => q.queryKey[0] !== "current-user",
      });
      queryClient.setQueryData(["current-user"], null);
      await queryClient.invalidateQueries({ queryKey: ["current-user"] });
      setMenu(false);
    } catch (e) {
      feedback(e instanceof Error ? e.message : "退出失败");
    }
  }
  return (
    <UserContext.Provider value={user}>
      <FeedbackContext.Provider value={feedback}>
        <div className={`app-shell ${board ? "board" : ""}`}>
          <header className="topbar">
            <div className="brand">
              <img src="/logo.svg" alt="一网统飞" />
              <strong>一网统飞平台</strong>
              <i />
              <span>
                {board
                  ? "指挥大屏"
                  : navigation.find((n) => n.id === view)?.label}
              </span>
            </div>
            <div className="topbar-actions">
              <time>
                {new Intl.DateTimeFormat("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                })
                  .format(new Date())
                  .replaceAll("/", ".")}
              </time>
              <Button
                small
                aria-pressed={board}
                title={board ? "返回进入大屏前的页面（Esc）" : "打开指挥大屏"}
                onClick={() => {
                  setBoard((current) => !current);
                  setMenu(false);
                }}
              >
                <Maximize size={12} />
                {board ? "返回工作台" : "指挥大屏"}
              </Button>
              <button
                className="icon-button"
                aria-label="待办通知"
                onClick={() => setNotifications(true)}
              >
                <Bell size={16} />
              </button>
              <div className="user-menu">
                <button onClick={() => setMenu(!menu)}>
                  <UserRound size={12} />
                  {ROLE_LABELS[user.role]}
                  <ChevronDown size={12} />
                </button>
                {menu && (
                  <div className="user-popover">
                    <strong>{user.displayName}</strong>
                    <small>{user.username}</small>
                    <button onClick={() => void logout()}>
                      <LogOut size={14} />
                      退出登录
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <aside className="sidebar">
            <nav aria-label="能力中心">
              {navigation.map((n) => (
                <button
                  className={n.id === view ? "active" : ""}
                  key={n.id}
                  onClick={() => navigate(n.id)}
                  title={n.label}
                >
                  <span>
                    <n.icon size={18} />
                  </span>
                  {n.label}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <button
                title="平台设置"
                aria-label="平台设置"
                onClick={() => {
                  setSettingsUserId(undefined);
                  setSettingsTab(undefined);
                  setSettings(true);
                }}
              >
                <SettingsIcon size={17} />
              </button>
              <button
                title="平台说明"
                aria-label="平台说明"
                onClick={() => setAbout(true)}
              >
                <ShieldCheck size={17} />
              </button>
            </div>
          </aside>
          <main className="main-workspace">
            {board ? (
              <CommandBoard navigate={navigate} />
            ) : view === "overview" ? (
              <Overview navigate={navigate} />
            ) : view === "dispatch" ? (
              <Tasks
                key={
                  params.get("taskId") || params.get("planId") || "task-list"
                }
                navigate={navigate}
                taskId={params.get("taskId") || undefined}
                planId={params.get("planId") || undefined}
              />
            ) : view === "flight" ? (
              <Flight
                key={params.get("deviceId") || "all-devices"}
                navigate={navigate}
                deviceId={params.get("deviceId") || undefined}
                taskId={params.get("taskId") || undefined}
              />
            ) : view === "services" ? (
              <Services
                key={params.get("planId") || "plan-list"}
                navigate={navigate}
                planId={params.get("planId") || undefined}
                taskId={params.get("taskId") || undefined}
              />
            ) : view === "resources" ? (
              <Resources />
            ) : view === "algorithms" ? (
              <Algorithms />
            ) : (
              <Scenes />
            )}
          </main>
          {settings && (
            <Modal title="平台设置" onClose={() => setSettings(false)} wide>
              <Settings
                key={settingsUserId || settingsTab || "default-settings"}
                initialTab={settingsTab}
                userId={settingsUserId}
              />
            </Modal>
          )}
          {about && (
            <Modal title="一网统飞平台" onClose={() => setAbout(false)}>
              <h2>独立的 React + Java 工作台</h2>
              <p>
                通过需求提报、资源分配、执行与验收完成业务闭环。设备、算法目录和飞行统计来自配置的数据来源。
              </p>
              <p className="muted">
                真实控制、完整历史轨迹、实时视频及训练服务接通后启用对应功能。当前界面保留扩展入口。
              </p>
            </Modal>
          )}
          {notifications && (
            <Modal title="待办通知" onClose={() => setNotifications(false)}>
              <div className="notification-links">
                <button
                  onClick={() => {
                    setNotifications(false);
                    navigate("dispatch");
                  }}
                >
                  任务受理与成果验收 <Send size={16} />
                </button>
                <button
                  onClick={() => {
                    setNotifications(false);
                    navigate("services");
                  }}
                >
                  计划与准入审核 <ShieldCheck size={16} />
                </button>
                <button
                  onClick={() => {
                    setNotifications(false);
                    navigate("scenes");
                  }}
                >
                  行业线索复核与处置 <Globe2 size={16} />
                </button>
              </div>
            </Modal>
          )}
          {toast && (
            <div className="toast" role="status">
              <ShieldCheck size={15} />
              {toast}
              <button onClick={() => setToast("")} aria-label="关闭消息">
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </FeedbackContext.Provider>
    </UserContext.Provider>
  );
}
