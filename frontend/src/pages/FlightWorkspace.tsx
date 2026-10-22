import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Maximize,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { api, ApiError, queryString, write, type Page } from "../api";
import { Button, Empty, PageHeader, SearchBox } from "../components/UI";
import SelectControl from "../components/SelectControl";
import { fourALoginUrl } from "../components/Login";
import { useUser } from "../context";
import { dateTime, statusLabel } from "../domain";
import {
  flightOrigin,
  HTTP_FLIGHT_NOTICE,
  isFlightMessage,
  registerFlightFrame,
  useFlightControlOptions,
  type FlightControlOptions,
} from "../flightEmbedding";
import type { Navigate } from "../navigation";
import "./flightEmbedding.css";

type Props = {
  navigate: Navigate;
  deviceId?: string;
  taskId?: string;
  onLogout?: () => void;
};
export type EntryCheck = {
  taskId: string;
  eligible: boolean;
  checks: {
    code: string;
    label: string;
    passed: boolean;
    message: string;
    action?: string;
  }[];
  context: {
    task: {
      id: string;
      title: string;
      status: string;
      startAt: string;
      endAt: string;
    };
    plan?: {
      id: string;
      title: string;
      status: string;
      startAt?: string;
      endAt?: string;
      kind?: string;
    } | null;
    device?: {
      id: string;
      title: string;
      status?: string;
      sourceDeviceId?: string;
    } | null;
    pilot?: { id: string; displayName: string } | null;
    sourceDeviceId?: string;
  };
  checkedAt: string;
};
type Launch = { url: string; origin: string; message?: string };
type FrameState = {
  url?: string;
  ready?: boolean;
  error?: string;
  loginRequired?: boolean;
  message?: string;
};
const identityError = (error: unknown) =>
  error instanceof ApiError &&
  (error.status === 401 ||
    [
      "FOUR_A_LOGIN_REQUIRED",
      "FOUR_A_SESSION_EXPIRED",
      "FLIGHT_SSO_REQUIRED",
      "BINDING_CHANGED",
      "ACCOUNT_PROJECTION_CHANGED",
    ].includes(error.code));

type EntryIssue = { message: string; label: string; action: string };
function entryIssue(check: EntryCheck): EntryIssue | undefined {
  if (check.eligible) return undefined;
  const { task, plan } = check.context;
  const checkedAt = Date.parse(check.checkedAt);
  const ended =
    Number.isFinite(checkedAt) &&
    Number.isFinite(Date.parse(task.endAt)) &&
    checkedAt >= Date.parse(task.endAt);
  if (
    ended ||
    ["COMPLETED", "CANCELLED", "PENDING_ACCEPTANCE"].includes(task.status)
  ) {
    const reusable =
      plan?.status === "APPROVED" &&
      !!plan.endAt &&
      Date.parse(plan.endAt) > checkedAt;
    return {
      message: ended
        ? "这个任务的执行时间已结束，请安排新的飞行。"
        : "这个任务已结束，请安排新的飞行。",
      label: reusable ? "安排新任务" : "重新申请",
      action: "NEW_FLIGHT",
    };
  }
  const failed = check.checks.filter((item) => !item.passed);
  const find = (...codes: string[]) =>
    failed.find((item) => codes.includes(item.code));
  if (
    find("DEVICE_ASSIGNMENT") &&
    check.context.device?.id &&
    check.context.device.status !== "ACTIVE"
  )
    return {
      message: "设备调度资料需要完善后才能使用。",
      label: "完善设备调度资料",
      action: "RESOURCE",
    };
  if (find("DEVICE_ASSIGNMENT", "PILOT_ASSIGNMENT"))
    return task.status === "PENDING_ASSIGNMENT"
      ? {
          message: "这个任务还没有安排好设备和飞手。",
          label: "分配设备和飞手",
          action: "ASSIGN",
        }
      : {
          message: "设备或飞手的执行安排需要重新确认。",
          label: "查看执行安排",
          action: "TASK",
        };
  if (find("PLAN_LINK"))
    return {
      message: "这个任务还未关联飞行申请。",
      label: "申请飞行",
      action: "NEW_FLIGHT",
    };
  if (find("PLAN_APPROVAL", "APPROVAL"))
    return {
      message: "飞行申请尚未审批通过，暂时不能进入。",
      label: "查看审批进度",
      action: "PLAN",
    };
  if (
    find("TASK_TIME", "WINDOW") &&
    Number.isFinite(checkedAt) &&
    Date.parse(task.startAt) > checkedAt
  )
    return {
      message: `任务尚未开始，请在 ${dateTime(task.startAt)} 后进入。`,
      label: "查看任务时间",
      action: "TASK",
    };
  if (find("SOURCE_DEVICE"))
    return {
      message: "执行设备尚未关联真实飞控设备。",
      label: "完善设备资料",
      action: "RESOURCE",
    };
  const first = failed[0];
  const action = first?.action || "REFRESH";
  return {
    message: first?.message || "任务信息需要完善后才能进入。",
    action,
    label:
      (
        {
          TASK: "调整任务安排",
          PLAN: "查看飞行申请",
          RESOURCE: "完善设备资料",
          PERMISSIONS: "查看业务授权",
          REFRESH: "重新检查",
        } as Record<string, string>
      )[action] || "重新检查",
  };
}

function TaskContext({
  check,
  navigate,
}: {
  check: EntryCheck;
  navigate: Navigate;
}) {
  const { task, plan, device, pilot } = check.context;
  return (
    <dl className="flight-entry-context">
      <div>
        <dt>执行任务</dt>
        <dd>
          <button
            className="flight-context-link"
            onClick={() => navigate("dispatch", { taskId: task.id })}
          >
            {task.title}
          </button>
          <span>{statusLabel(task.status)}</span>
        </dd>
      </div>
      <div>
        <dt>关联计划 / 审批</dt>
        <dd>
          {plan?.id ? (
            <>
              <button
                className="flight-context-link"
                onClick={() => navigate("services", { planId: plan.id })}
              >
                {plan.title}
              </button>
              <span>{statusLabel(plan.status)}</span>
            </>
          ) : (
            "未关联计划"
          )}
        </dd>
      </div>
      <div>
        <dt>执行时段</dt>
        <dd>
          {dateTime(task.startAt)} 至 {dateTime(task.endAt)}
        </dd>
      </div>
      <div>
        <dt>设备 / 飞手</dt>
        <dd>
          {device?.title || "未分配设备"} / {pilot?.displayName || "未分配飞手"}
        </dd>
      </div>
    </dl>
  );
}

export function EmbeddedFlight({
  options,
  navigate,
  deviceId,
  taskId,
  onLogout,
}: Props & { options: FlightControlOptions }) {
  const user = useUser();
  const client = useQueryClient();
  const frame = useRef<HTMLIFrameElement>(null);
  const logoutCallback = useRef(onLogout);
  logoutCallback.current = onLogout;
  const launchPending = useRef(false);
  const launchGeneration = useRef(0);
  const [selectedTask, setSelectedTask] = useState(taskId || "");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [launching, setLaunching] = useState(false);
  const [state, setState] = useState<FrameState>({});
  const [activeCheck, setActiveCheck] = useState<EntryCheck>();
  const [liveWarning, setLiveWarning] = useState("");
  const [collapsed, setCollapsed] = useState(true);
  const [checksExpanded, setChecksExpanded] = useState(false);
  const [includeExpired, setIncludeExpired] = useState(false);
  const autoSelectionUsed = useRef(false);
  let origin = "";
  let configurationError = "";
  try {
    origin = flightOrigin(options);
  } catch (error) {
    configurationError =
      error instanceof Error ? error.message : "飞控配置无效";
  }
  const canRequest =
    user?.businessAccessAssigned !== false &&
    (!user || ["ADMIN", "DISPATCH", "PILOT"].includes(user.role));
  const canAssign =
    user?.businessAccessAssigned !== false &&
    !!user &&
    ["ADMIN", "DISPATCH"].includes(user.role);
  const candidates = useQuery({
    queryKey: [
      "flight-entry-tasks",
      user?.id,
      page,
      keyword,
      deviceId,
      includeExpired,
    ],
    queryFn: () =>
      api<Page<EntryCheck>>(
        `/flight-control/tasks?${queryString({ page, pageSize: 20, keyword, deviceId, includeExpired })}`,
      ),
    enabled: !!origin && canRequest && !activeCheck,
    retry: false,
  });
  const preflight = useQuery({
    queryKey: ["flight-entry-preflight", user?.id, selectedTask],
    queryFn: () =>
      api<EntryCheck>(
        `/flight-control/preflight?${queryString({ taskId: selectedTask })}`,
      ),
    enabled: !!origin && !!selectedTask && canRequest && !activeCheck,
    retry: false,
  });
  useEffect(() => {
    if (
      taskId ||
      selectedTask ||
      autoSelectionUsed.current ||
      activeCheck ||
      !candidates.data ||
      candidates.data.total !== candidates.data.items.length
    )
      return;
    const suitable = candidates.data.items.filter((item) => item.eligible);
    if (suitable.length === 1) {
      autoSelectionUsed.current = true;
      setSelectedTask(suitable[0].taskId);
    }
  }, [taskId, selectedTask, activeCheck, candidates.data]);
  useEffect(
    () => () => {
      launchGeneration.current++;
    },
    [],
  );
  useEffect(() => {
    if (!activeCheck) return;
    let cancelled = false;
    let running = false;
    const poll = async () => {
      if (document.visibilityState === "hidden" || running) return;
      running = true;
      try {
        const result = await api<EntryCheck>(
          `/flight-control/preflight?${queryString({ taskId: activeCheck.taskId })}`,
        );
        if (!cancelled) setLiveWarning(entryIssue(result)?.message || "");
      } catch (error) {
        if (!cancelled) {
          if (identityError(error)) {
            setState({
              error: "4A 登录已失效，请重新登录后进入飞控。",
              loginRequired: true,
            });
            void client.invalidateQueries({ queryKey: ["current-user"] });
          } else
            setLiveWarning(
              error instanceof Error
                ? error.message
                : "业务状态暂时无法确认，再次进入前须重新检查。",
            );
        }
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 30_000);
    const visible = () => {
      if (document.visibilityState !== "hidden") void poll();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [activeCheck, client]);
  useEffect(() => {
    if (!state.url || !frame.current || !origin) return;
    const unregister = registerFlightFrame(frame.current, origin);
    let timer: number;
    const receive = (event: MessageEvent) => {
      if (!isFlightMessage(event, origin, frame.current?.contentWindow || null))
        return;
      if (event.data.type === "READY") {
        window.clearTimeout(timer);
        setState((current) => ({ ...current, ready: true }));
      } else if (event.data.type === "AUTH_EXPIRED") {
        setState({
          error: "4A 登录已失效，请重新登录后进入飞控。",
          loginRequired: true,
        });
        void client.invalidateQueries({ queryKey: ["current-user"] });
      } else if (["ADAPTER_ERROR", "ENTRY_DENIED"].includes(event.data.type)) {
        setState({
          error:
            typeof event.data.message === "string" &&
            event.data.message.length > 0 &&
            event.data.message.length <= 200
              ? event.data.message
              : event.data.type === "ENTRY_DENIED"
                ? "飞控入口未放行，请重新选择任务并检查业务条件"
                : "飞控页面适配失败，上游页面结构可能已变化，请联系管理员",
        });
      } else if (event.data.type === "LOGGED_OUT") {
        setState({ error: "飞控已退出，请重新进入" });
        logoutCallback.current?.();
      }
    };
    window.addEventListener("message", receive);
    timer = window.setTimeout(
      () => setState({ error: "飞控加载超时，请检查网关与飞控连接后重试" }),
      30_000,
    );
    return () => {
      unregister();
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
  }, [state.url, origin, client]);
  async function launch() {
    if (
      !selectedTask ||
      !preflight.data?.eligible ||
      launchPending.current ||
      !canRequest ||
      !origin
    )
      return;
    launchPending.current = true;
    setLaunching(true);
    setState({});
    const generation = ++launchGeneration.current;
    try {
      const result = await write<Launch>("/flight-control/launch", {
        taskId: selectedTask,
      });
      if (generation !== launchGeneration.current) return;
      const url = new URL(result.url);
      if (
        result.origin !== origin ||
        url.origin !== origin ||
        url.pathname !== "/__oneflight/bootstrap" ||
        url.username ||
        url.password ||
        url.hash ||
        url.searchParams.getAll("ticket").length !== 1 ||
        !url.searchParams.get("ticket") ||
        url.searchParams.get("ticket")!.length > 512 ||
        [...url.searchParams.keys()].some((key) => key !== "ticket")
      )
        throw new Error("飞控启动地址无效，请联系管理员");
      setActiveCheck(preflight.data);
      setState({ url: url.href, message: result.message });
    } catch (error) {
      if (generation === launchGeneration.current) {
        setState({
          error: error instanceof Error ? error.message : "飞控启动失败",
          loginRequired: identityError(error),
        });
        void preflight.refetch();
      }
    } finally {
      if (generation === launchGeneration.current) {
        launchPending.current = false;
        setLaunching(false);
      }
    }
  }
  function action(code?: string) {
    if (code === "NEW_FLIGHT") {
      navigate("services", {
        action: "apply",
        ...(preflight.data?.context.plan?.id
          ? { planId: preflight.data.context.plan.id }
          : {}),
      });
    } else if (code === "ASSIGN")
      navigate("dispatch", { taskId: selectedTask, action: "assign" });
    else if (code === "TASK" || code === "dispatch")
      navigate("dispatch", selectedTask ? { taskId: selectedTask } : {});
    else if (code === "PLAN" || code === "services")
      navigate(
        "services",
        preflight.data?.context.plan?.id
          ? { planId: preflight.data.context.plan.id }
          : {},
      );
    else if (code === "RESOURCE" || code === "resources") navigate("resources");
    else if (code === "PERMISSIONS" || code === "settings")
      navigate("settings", { userId: user?.id });
    else void preflight.refetch();
  }
  const canAssignSelectedTask =
    canAssign && preflight.data?.context.task.status === "PENDING_ASSIGNMENT";
  const issue = preflight.data ? entryIssue(preflight.data) : undefined;
  const assignmentNeedsDispatcher = issue?.action === "ASSIGN" && !canAssign;
  const failedCount =
    preflight.data?.checks.filter((item) => !item.passed).length || 0;
  const activeWarning = !canRequest
    ? "平台业务权限已变化，再次进入飞控前须重新授权。"
    : liveWarning;
  const error = configurationError || state.error;
  const httpCompatibility = options.transportMode === "http-ip";
  const notices = [
    httpCompatibility ? HTTP_FLIGHT_NOTICE : options.message,
    state.message,
  ].filter(
    (item, index, all): item is string =>
      !!item &&
      item.length <= 300 &&
      all.indexOf(item) === index &&
      !(index === 1 && httpCompatibility && item.startsWith("HTTP 兼容模式")),
  );
  return (
    <div className="page embedded-flight">
      <PageHeader
        title="飞行管控"
        subtitle="选择任务后自动检查，条件满足即可进入飞控。"
      >
        <Button
          small
          onClick={() =>
            navigate(
              "dispatch",
              activeCheck?.taskId || selectedTask
                ? { taskId: activeCheck?.taskId || selectedTask }
                : {},
            )
          }
        >
          <ArrowLeft size={13} />
          返回任务列表
        </Button>
        {state.ready && (
          <Button
            small
            onClick={() => void frame.current?.requestFullscreen?.()}
          >
            <Maximize size={13} />
            飞控全屏
          </Button>
        )}
      </PageHeader>
      {activeCheck ? (
        <>
          <section className="flight-entry-summary" aria-label="当前放行任务">
            <div className="flight-entry-summary-heading">
              <strong>
                <ShieldCheck size={15} />
                {activeCheck.context.task.title}
              </strong>
              <span className="flight-entry-active-brief">
                {activeCheck.context.device?.title || "执行设备"} ·{" "}
                {dateTime(activeCheck.context.task.startAt)} 至{" "}
                {dateTime(activeCheck.context.task.endAt)}
              </span>
              <Button
                small
                aria-expanded={!collapsed}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronUp size={13} />
                )}
                {collapsed ? "展开任务信息" : "收起任务信息"}
              </Button>
            </div>
            {!collapsed && (
              <>
                <TaskContext check={activeCheck} navigate={navigate} />
                <p className="muted">
                  本平台审批用于入口业务放行；牍术内的设备切换与真实操作按牍术权限执行。
                </p>
              </>
            )}
            {activeWarning && (
              <p role="alert" className="flight-entry-warning">
                {activeWarning} 当前已打开的飞控继续保留，再次进入将重新检查。
              </p>
            )}
          </section>
          {notices.length > 0 && (
            <p className="embedded-flight-notice" role="note">
              {notices.join(" ")}
            </p>
          )}
          <div className="embedded-flight-stage">
            {!error && state.url && (
              <iframe
                ref={frame}
                title="牍术飞控操作区"
                src={state.url}
                referrerPolicy="no-referrer"
                allow={
                  !httpCompatibility &&
                  window.isSecureContext &&
                  options.capabilities?.microphone === true
                    ? "fullscreen; autoplay; microphone"
                    : "fullscreen; autoplay"
                }
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock allow-popups"
                allowFullScreen
                style={{ visibility: state.ready ? "visible" : "hidden" }}
              />
            )}
            {!state.ready && (
              <div className="embedded-flight-status" role="status">
                <Empty
                  loading={!error}
                  title="飞控暂不可用"
                  description={error || "正在建立飞控登录状态…"}
                />
                {error &&
                  !configurationError &&
                  (state.loginRequired ? (
                    <a
                      className="button primary"
                      href={fourALoginUrl({
                        view: "flight",
                        deviceId,
                        taskId: activeCheck.taskId,
                      })}
                    >
                      4A 统一登录
                    </a>
                  ) : (
                    <Button
                      onClick={() => {
                        setActiveCheck(undefined);
                        setState({});
                        setLiveWarning("");
                        void preflight.refetch();
                      }}
                    >
                      <RefreshCw size={13} />
                      重新检查任务
                    </Button>
                  ))}
              </div>
            )}
          </div>
        </>
      ) : configurationError ? (
        <Empty title="飞控暂不可用" description={configurationError} />
      ) : !canRequest ? (
        <Empty
          title="尚无飞控入口业务权限"
          description="请由平台管理员在权限管理中配置业务权限。进入飞控须以管理员、调度或飞手身份执行已放行任务。"
        />
      ) : (
        <section className="flight-entry-panel">
          <div className="flight-entry-card">
            <div className="flight-entry-card-heading">
              <h2>选择执行任务</h2>
              <label className="flight-entry-expired">
                <input
                  type="checkbox"
                  checked={includeExpired}
                  disabled={launching}
                  onChange={(event) => {
                    setIncludeExpired(event.target.checked);
                    setPage(1);
                  }}
                />
                查看已过期任务
              </label>
            </div>
            {(keyword || (candidates.data?.total || 0) > 5) && (
              <SearchBox
                value={keyword}
                onChange={(value) => {
                  setKeyword(value);
                  setPage(1);
                }}
                placeholder="搜索任务名称"
              />
            )}
            {deviceId && <p className="muted">已筛选所选设备的关联任务。</p>}
            {(selectedTask || (candidates.data?.total || 0) > 0) && (
              <div className="flight-entry-select">
                <label htmlFor="flight-entry-task">执行任务</label>
                <SelectControl
                  id="flight-entry-task"
                  aria-label="执行任务"
                  value={selectedTask}
                  disabled={launching}
                  searchable={false}
                  onChange={(value) => {
                    autoSelectionUsed.current = true;
                    setSelectedTask(value);
                    setChecksExpanded(false);
                    setState({});
                  }}
                  options={[
                    { value: "", label: "请选择执行任务" },
                    ...(selectedTask &&
                    !candidates.data?.items.some(
                      (item) => item.taskId === selectedTask,
                    )
                      ? [
                          {
                            value: selectedTask,
                            label:
                              preflight.data?.context.task.title ||
                              "当前关联任务",
                          },
                        ]
                      : []),
                    ...(candidates.data?.items.map((item) => ({
                      value: item.taskId,
                      label: `${item.context.task.title} · ${statusLabel(item.context.task.status)}${item.eligible ? " · 可进入" : ""}`,
                      description: `设备：${item.context.device?.title || "未分配"} · 飞手：${item.context.pilot?.displayName || "未分配"}`,
                    })) || []),
                  ]}
                />
              </div>
            )}
            {candidates.isPending && <p role="status">正在读取任务…</p>}
            {candidates.error && (
              <>
                <p role="alert">{candidates.error.message}</p>
                <Button small onClick={() => void candidates.refetch()}>
                  重新读取任务
                </Button>
              </>
            )}
            {candidates.data && candidates.data.total > 20 && (
              <div className="flight-entry-pagination">
                <Button
                  small
                  disabled={page === 1 || launching}
                  onClick={() => setPage((value) => value - 1)}
                >
                  上一页
                </Button>
                <span>
                  第 {page} 页 / 共 {candidates.data.total} 条
                </span>
                <Button
                  small
                  disabled={page * 20 >= candidates.data.total || launching}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </Button>
              </div>
            )}
            {selectedTask ? (
              <div className="flight-entry-checks">
                {preflight.isPending ? (
                  <p role="status">正在自动检查进入条件…</p>
                ) : preflight.error ? (
                  <>
                    <p role="alert" className="flight-entry-warning">
                      {preflight.error.message}
                    </p>
                    <Button onClick={() => void preflight.refetch()}>
                      重新检查
                    </Button>
                  </>
                ) : (
                  preflight.data && (
                    <>
                      <dl className="flight-entry-brief">
                        <div>
                          <dt>设备</dt>
                          <dd>
                            {preflight.data.context.device?.title || "尚未分配"}
                          </dd>
                        </div>
                        <div>
                          <dt>关联飞手</dt>
                          <dd className="flight-entry-pilot">
                            <span>
                              {preflight.data.context.pilot?.displayName ||
                                "尚未分配"}
                            </span>
                            <button
                              type="button"
                              className="flight-context-link"
                              disabled={launching}
                              onClick={() =>
                                action(
                                  canAssignSelectedTask ? "ASSIGN" : "TASK",
                                )
                              }
                            >
                              {canAssignSelectedTask
                                ? "分配飞手"
                                : "查看执行安排"}
                              <ArrowRight size={12} aria-hidden="true" />
                            </button>
                          </dd>
                        </div>
                        <div className="flight-entry-time">
                          <dt>执行时段</dt>
                          <dd>
                            {dateTime(preflight.data.context.task.startAt)} 至{" "}
                            {dateTime(preflight.data.context.task.endAt)}
                          </dd>
                        </div>
                      </dl>
                      {issue ? (
                        <div className="flight-entry-primary-issue">
                          <p role="status">{issue.message}</p>
                          {assignmentNeedsDispatcher && (
                            <p className="muted">
                              请联系管理员或调度人员分配设备和飞手。
                            </p>
                          )}
                          {failedCount > 1 && (
                            <p className="muted">
                              共 {failedCount}{" "}
                              项信息需要完善，可在检查详情中查看。
                            </p>
                          )}
                          <Button
                            primary
                            disabled={launching}
                            onClick={() =>
                              action(
                                assignmentNeedsDispatcher
                                  ? "TASK"
                                  : issue.action,
                              )
                            }
                          >
                            {assignmentNeedsDispatcher
                              ? "查看执行安排"
                              : issue.label}
                          </Button>
                        </div>
                      ) : (
                        <>
                          <p role="status" className="flight-entry-success">
                            <Check size={16} />
                            条件已满足，点击进入即可。
                          </p>
                          <Button
                            primary
                            disabled={launching || preflight.isFetching}
                            onClick={() => void launch()}
                          >
                            <ShieldCheck size={14} />
                            {launching ? "正在进入…" : "进入飞控"}
                          </Button>
                        </>
                      )}
                      <div className="flight-entry-details">
                        <Button
                          small
                          aria-expanded={checksExpanded}
                          onClick={() => setChecksExpanded((value) => !value)}
                        >
                          {checksExpanded ? (
                            <ChevronUp size={13} />
                          ) : (
                            <ChevronDown size={13} />
                          )}
                          {checksExpanded ? "收起检查详情" : "查看检查详情"}
                        </Button>
                        {checksExpanded && (
                          <div className="flight-entry-detail-content">
                            <TaskContext
                              check={preflight.data}
                              navigate={navigate}
                            />
                            <ul className="flight-check-list">
                              {preflight.data.checks.map((item) => (
                                <li
                                  key={item.code}
                                  className={item.passed ? "passed" : "blocked"}
                                >
                                  {item.passed ? (
                                    <Check size={15} />
                                  ) : (
                                    <X size={15} />
                                  )}
                                  <div>
                                    <strong>{item.label}</strong>
                                    <p>{item.message}</p>
                                  </div>
                                </li>
                              ))}
                            </ul>
                            <p className="muted">
                              检查时间：{dateTime(preflight.data.checkedAt)}
                              。进入时会再次核验，进入飞控不会自动登记起飞或任务开始。
                            </p>
                            <Button
                              small
                              disabled={launching || preflight.isFetching}
                              onClick={() => void preflight.refetch()}
                            >
                              <RefreshCw size={13} />
                              重新检查
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  )
                )}
                {state.error && (
                  <p role="alert" className="flight-entry-warning">
                    {state.error}
                  </p>
                )}
                {state.loginRequired && (
                  <a
                    className="button primary"
                    href={fourALoginUrl({
                      view: "flight",
                      deviceId,
                      taskId: selectedTask,
                    })}
                  >
                    4A 统一登录
                  </a>
                )}
              </div>
            ) : (
              !candidates.isPending &&
              !candidates.error && (
                <div className="flight-entry-empty">
                  <p>
                    {candidates.data?.total
                      ? "选择一个任务，系统会自动检查进入条件。"
                      : "暂无可执行任务，提交飞行申请后即可在这里进入。"}
                  </p>
                  <div className="flight-entry-assignment-hint">
                    <p>
                      关联飞手由管理员或调度人员在“任务调度 → 分配资源”中设置。
                    </p>
                    {canAssign && (
                      <Button small onClick={() => navigate("dispatch", {})}>
                        前往任务调度 <ArrowRight size={12} />
                      </Button>
                    )}
                  </div>
                  <Button
                    primary
                    onClick={() => navigate("services", { action: "apply" })}
                  >
                    申请飞行
                  </Button>
                </div>
              )
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default function FlightWorkspace(props: Props) {
  const options = useFlightControlOptions(true);
  if (!options.data || options.error)
    return (
      <div className="page">
        <PageHeader title="飞行管控">
          <Button onClick={() => props.navigate("dispatch")}>
            <ArrowLeft size={13} />
            返回任务列表
          </Button>
        </PageHeader>
        <Empty
          loading={options.isPending}
          error={options.error}
          description="正在读取飞控接入方式…"
        />
        {options.error && (
          <Button onClick={() => void options.refetch()}>重新读取配置</Button>
        )}
      </div>
    );
  if (options.data.mode !== "embedded" || options.data.requiresTask !== true)
    return (
      <div className="page">
        <PageHeader title="飞行管控">
          <Button onClick={() => props.navigate("dispatch")}>
            <ArrowLeft size={13} />
            返回任务列表
          </Button>
        </PageHeader>
        <Empty
          title="当前接入方式不支持任务放行"
          description="请联系管理员启用代理嵌入模式及任务放行配置后使用飞控入口。"
        />
      </div>
    );
  return <EmbeddedFlight {...props} options={options.data} />;
}
