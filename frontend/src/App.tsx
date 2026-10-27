import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Boxes,
  ChevronDown,
  Compass,
  FlaskConical,
  Globe2,
  LayoutDashboard,
  LogOut,
  Maximize,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { api, ApiError, type CurrentUser } from "./api";
import type { Navigate } from "./navigation";
import { ROLE_LABELS } from "./domain";
import { FeedbackContext, UserContext } from "./context";
import { Button, Empty, Modal, PageHeader } from "./components/UI";
import Overview from "./pages/Overview";
import CommandBoard from "./pages/CommandBoard";
import Tasks from "./pages/Tasks";
import FlightWorkspace from "./pages/FlightWorkspace";
import Login, { authErrorMessage, type AuthOptions } from "./components/Login";
import {
  clearFlightIdentity,
  flightOrigin,
  useFlightControlOptions,
} from "./flightEmbedding";
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
const authenticationQueryKeys = new Set(["current-user", "auth-options"]);
function isBusinessQuery(query: { queryKey: readonly unknown[] }) {
  return !authenticationQueryKeys.has(String(query.queryKey[0]));
}

const headerDateFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function FileIcon({ size = 18 }: { size?: number }) {
  return <ShieldCheck size={size} />;
}
export default function App() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const authOptions = useQuery({
    queryKey: ["auth-options"],
    queryFn: () => api<AuthOptions>("/auth/options"),
    retry: false,
    staleTime: 60_000,
  });
  const me = useQuery({
    queryKey: ["current-user"],
    queryFn: () => api<CurrentUser>("/auth/me"),
    retry: false,
    staleTime: 60_000,
    refetchInterval: (query) =>
      authOptions.data?.mode === "4a" && query.state.data ? 30_000 : false,
  });
  const user =
    me.error instanceof ApiError && me.error.status === 401
      ? undefined
      : me.data;
  const flightOptions = useFlightControlOptions(!!user);
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);
  const previousUserId = useRef<string | undefined>(undefined);
  const [sessionNotice, setSessionNotice] = useState(() =>
    authErrorMessage(params.get("authError")),
  );
  const [settings, setSettings] = useState(false);
  const [settingsUserId, setSettingsUserId] = useState<string>();
  const [settingsTab, setSettingsTab] = useState<string>();
  const [about, setAbout] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [menu, setMenu] = useState(false);
  const [board, setBoard] = useState(false);
  const [toast, setToast] = useState("");
  const selected = params.get("view") || "overview";
  const currentNavigation =
    navigation.find((item) => item.id === selected) || navigation[0];
  const view = currentNavigation.id;
  useEffect(() => {
    if (user && sessionNotice) setToast(sessionNotice);
  }, [user?.id, sessionNotice]);
  useEffect(() => {
    if (user && previousUserId.current && previousUserId.current !== user.id)
      void queryClient.resetQueries({
        predicate: isBusinessQuery,
      });
    previousUserId.current = user?.id;
  }, [user?.id, queryClient]);
  useEffect(() => {
    if (
      params.has("authError") ||
      params.has("authVerified") ||
      params.has("authSuccess")
    ) {
      const next = new URLSearchParams(params);
      next.delete("authError");
      next.delete("authVerified");
      next.delete("authSuccess");
      setParams(next, { replace: true });
    }
  }, [params, setParams, user]);
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401 && me.data) {
      if (flightOptions.data?.mode === "embedded") {
        try {
          void clearFlightIdentity(flightOrigin(flightOptions.data));
        } catch {
          /* Invalid gateway configuration cannot block local expiry. */
        }
      }
      setSessionNotice("登录已失效，请重新登录。");
      queryClient.removeQueries({
        predicate: isBusinessQuery,
      });
      queryClient.setQueryData(["current-user"], null);
    }
  }, [me.error, me.data, flightOptions.data, queryClient]);
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
    if (context.resourceKind) next.resourceKind = context.resourceKind;
    if (context.resourceSearch) next.resourceSearch = context.resourceSearch;
    if (context.action) next.action = context.action;
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
  if (!user)
    return (
      <Login
        options={authOptions.data}
        optionsError={authOptions.error}
        onRetry={() => void authOptions.refetch()}
        notice={sessionNotice}
        loginContext={{
          view,
          deviceId: params.get("deviceId") || undefined,
          taskId: params.get("taskId") || undefined,
        }}
        onSuccess={() => {
          setSessionNotice("");
          queryClient.removeQueries({
            predicate: isBusinessQuery,
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
  async function logout(childAlreadyCleared = false) {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setLoggingOut(true);
    let cleared = true;
    if (!childAlreadyCleared && flightOptions.data?.mode === "embedded") {
      try {
        cleared = await clearFlightIdentity(flightOrigin(flightOptions.data));
      } catch {
        cleared = false;
      }
    }
    try {
      const result = await api<{
        externalLogoutSucceeded: boolean;
        message?: string;
      }>("/auth/logout", { method: "POST" });
      const notices: string[] = [];
      if (!cleared)
        notices.push("飞控登录存储清理未确认，下次进入将重新建立身份。");
      if (result?.externalLogoutSucceeded === false)
        notices.push(
          result.message || "平台已退出，4A 注销未成功，请同时退出 4A。",
        );
      setSessionNotice(notices.join(" "));
      queryClient.removeQueries({
        predicate: isBusinessQuery,
      });
      queryClient.setQueryData(["current-user"], null);
      await queryClient.invalidateQueries({ queryKey: ["current-user"] });
      setMenu(false);
    } catch (e) {
      feedback(e instanceof Error ? e.message : "退出失败");
    } finally {
      loggingOutRef.current = false;
      setLoggingOut(false);
    }
  }
  return (
    <UserContext.Provider key={user.id} value={user}>
      <FeedbackContext.Provider value={feedback}>
        <div className={`app-shell ${board ? "board" : ""}`}>
          <header className="topbar">
            <div className="brand">
              <img src="/logo.svg" alt="一网统飞" />
              <strong>一网统飞平台</strong>
              <i />
              <span>{board ? "指挥大屏" : currentNavigation.label}</span>
            </div>
            <div className="topbar-actions">
              <time>
                {headerDateFormat.format(new Date()).replaceAll("/", ".")}
              </time>
              <Button
                small
                disabled={user.businessAccessAssigned === false}
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
                  {user.businessAccessAssigned === false
                    ? "待业务授权"
                    : ROLE_LABELS[user.role]}
                  <ChevronDown size={12} />
                </button>
                {menu && (
                  <div className="user-popover">
                    <strong>{user.displayName}</strong>
                    <small>{user.username}</small>
                    {user.role === "ADMIN" &&
                      user.businessAccessAssigned !== false && (
                        <button
                          onClick={() => {
                            navigate("settings");
                            setMenu(false);
                          }}
                        >
                          <SettingsIcon size={14} />
                          权限管理
                        </button>
                      )}
                    <button disabled={loggingOut} onClick={() => void logout()}>
                      <LogOut size={14} />
                      {loggingOut ? "正在退出…" : "退出登录"}
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
            {user.businessAccessAssigned === false &&
            (view !== "flight" || board) ? (
              <div className="page">
                <PageHeader title="平台业务权限待配置" />
                <Empty
                  title="已通过 4A 登录"
                  description="请联系平台管理员配置岗位、组织和业务范围。飞控入口也须完成本平台业务授权和任务放行。"
                />
              </div>
            ) : board ? (
              <CommandBoard navigate={navigate} />
            ) : view === "overview" ? (
              <Overview navigate={navigate} />
            ) : view === "dispatch" ? (
              <Tasks
                key={`${params.get("taskId") || params.get("planId") || "task-list"}:${params.get("action") || ""}`}
                navigate={navigate}
                taskId={params.get("taskId") || undefined}
                planId={params.get("planId") || undefined}
                initialAction={params.get("action") || undefined}
              />
            ) : view === "flight" ? (
              <FlightWorkspace
                key={`${user.id}:${params.get("deviceId") || "all-devices"}:${params.get("taskId") || ""}`}
                navigate={navigate}
                onLogout={() => void logout(true)}
                deviceId={params.get("deviceId") || undefined}
                taskId={params.get("taskId") || undefined}
              />
            ) : view === "services" ? (
              <Services
                key={`${params.get("planId") || "plan-list"}:${params.get("action") || ""}`}
                navigate={navigate}
                planId={params.get("planId") || undefined}
                taskId={params.get("taskId") || undefined}
                initialAction={params.get("action") || undefined}
              />
            ) : view === "resources" ? (
              <Resources
                key={`${params.get("resourceKind") || "default"}:${params.get("resourceSearch") || ""}`}
                navigate={navigate}
                initialKind={params.get("resourceKind") || undefined}
                initialSearch={params.get("resourceSearch") || undefined}
              />
            ) : view === "algorithms" ? (
              <Algorithms />
            ) : (
            <Scenes navigate={navigate} />
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
                飞控使用当前 4A 账号的牍术权限。任务审批用于平台业务流程。
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
