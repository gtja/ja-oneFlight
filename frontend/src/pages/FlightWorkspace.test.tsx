// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://192.0.2.20:8088"}
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlightWorkspace, { type EntryCheck } from "./FlightWorkspace";
import {
  FLIGHT_NAMESPACE,
  HTTP_FLIGHT_NOTICE,
  type FlightControlOptions,
} from "../flightEmbedding";
import { UserContext } from "../context";
import type { CurrentUser } from "../api";

const legacy = vi.hoisted(() => vi.fn());
vi.mock("./Flight", () => ({
  default: (props: unknown) => {
    legacy(props);
    return <div>legacy-flight</div>;
  },
}));
const origin = "https://flight.example.test";
const clients: QueryClient[] = [];
const user: CurrentUser = {
  id: "user-1",
  username: "pilot",
  displayName: "飞手",
  role: "PILOT",
  organizationId: "org-1",
  regions: [],
  deviceIds: [],
  businessAccessAssigned: true,
};
const allowed: EntryCheck = {
  taskId: "task-id",
  eligible: true,
  checkedAt: "2026-10-21T03:00:00Z",
  context: {
    task: {
      id: "task-id",
      title: "机场巡检",
      status: "PENDING_EXECUTION",
      startAt: "2026-10-21T02:00:00Z",
      endAt: "2026-10-21T04:00:00Z",
    },
    plan: { id: "plan-id", title: "日常巡检计划", status: "APPROVED" },
    device: {
      id: "local-device",
      title: "机场一号",
      sourceDeviceId: "source-device",
    },
    pilot: { id: "user-1", displayName: "飞手" },
    sourceDeviceId: "source-device",
  },
  checks: [
    {
      code: "APPROVAL",
      label: "计划审批",
      passed: true,
      message: "关联计划已审批通过。",
    },
    {
      code: "WINDOW",
      label: "执行时段",
      passed: true,
      message: "处于任务执行时段。",
    },
  ],
};
const reply = (
  data: unknown,
  status = 200,
  message = "当前账号无飞控权限",
  code = "FORBIDDEN",
) =>
  new Response(
    JSON.stringify({ code: status === 200 ? "SUCCESS" : code, message, data }),
    { status },
  );
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  legacy.mockClear();
});
function start(
  overrides: {
    launch?: unknown;
    launchStatus?: number;
    launchCode?: string;
    options?: Promise<Response>;
    configuration?: FlightControlOptions;
    selectedTask?: string | null;
    check?: EntryCheck;
    checkStatus?: number;
    initialUser?: CurrentUser;
    candidates?: EntryCheck[];
    candidatesTotal?: number;
  } = {},
) {
  let check = overrides.check || allowed;
  let checkStatus = overrides.checkStatus || 200;
  const requests = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = new URL(url, window.location.origin).pathname;
    if (path.endsWith("/flight-control/options"))
      return (
        overrides.options ||
        reply(
          overrides.configuration || {
            mode: "embedded",
            origin,
            requiresTask: true,
          },
        )
      );
    if (path.endsWith("/flight-control/tasks"))
      return reply({
        items: overrides.candidates || [check],
        total: overrides.candidatesTotal ?? overrides.candidates?.length ?? 1,
        page: 1,
        pageSize: 20,
      });
    if (path.endsWith("/flight-control/preflight"))
      return reply(
        check,
        checkStatus,
        checkStatus === 404 ? "任务不在当前可见范围内" : "业务权限已变化",
        checkStatus === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
      );
    if (path.endsWith("/auth/csrf"))
      return reply({ token: "csrf", headerName: "X-CSRF-TOKEN" });
    if (path.endsWith("/flight-control/launch"))
      return reply(
        overrides.launch || {
          url: `${origin}/__oneflight/bootstrap?ticket=temporary-ticket`,
          origin,
        },
        overrides.launchStatus || 200,
        overrides.launchCode
          ? "请通过 4A 统一登录后进入飞控"
          : "当前账号无飞控权限",
        overrides.launchCode,
      );
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", requests);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const navigate = vi.fn();
  const selectedTask =
    overrides.selectedTask === null
      ? undefined
      : overrides.selectedTask || "task-id";
  const tree = (currentUser: CurrentUser) => (
    <QueryClientProvider client={client}>
      <UserContext.Provider value={currentUser}>
        <FlightWorkspace
          navigate={navigate}
          deviceId="source-device"
          taskId={selectedTask}
        />
      </UserContext.Provider>
    </QueryClientProvider>
  );
  const view = render(tree(overrides.initialUser || user));
  return {
    requests,
    navigate,
    setCheck: (value: EntryCheck, status = 200) => {
      check = value;
      checkStatus = status;
    },
    setUser: (value: CurrentUser) => view.rerender(tree(value)),
  };
}
async function enter() {
  const button = await screen.findByRole("button", {
    name: "进入飞控",
  });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  await act(async () => {
    fireEvent.click(button);
  });
  return (await screen.findByTitle("牍术飞控操作区")) as HTMLIFrameElement;
}
function message(
  frame: HTMLIFrameElement,
  type: string,
  source: Window | null = frame.contentWindow,
  messageOrigin = origin,
) {
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: messageOrigin,
        source,
        data: { namespace: FLIGHT_NAMESPACE, type },
      }),
    ),
  );
}
function launchCount(requests: ReturnType<typeof start>["requests"]) {
  return requests.mock.calls.filter(([url]) =>
    url.endsWith("/flight-control/launch"),
  ).length;
}

describe("task-gated native flight workspace", () => {
  it("preselects a task, shows approval context, and launches only after explicit confirmation", async () => {
    const { requests, navigate } = start();
    await screen.findByText("条件已满足，点击进入即可。");
    expect(screen.queryByText("关联计划已审批通过。")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看检查详情" }));
    await screen.findByText("关联计划已审批通过。");
    expect(
      screen
        .getByRole("button", { name: /机场巡检 · 待执行 · 可进入/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    expect(launchCount(requests)).toBe(0);
    const frame = await enter();
    expect(frame.src).toContain("/__oneflight/bootstrap?ticket=");
    const call = requests.mock.calls.find(([url]) =>
      url.endsWith("/flight-control/launch"),
    )!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ taskId: "task-id" });
    expect(screen.queryByRole("button", { name: "日常巡检计划" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "展开任务信息" }));
    fireEvent.click(screen.getByRole("button", { name: "日常巡检计划" }));
    expect(navigate).toHaveBeenCalledWith("services", { planId: "plan-id" });
    expect(legacy).not.toHaveBeenCalled();
    expect(requests.mock.calls.some(([url]) => url.includes("/devices"))).toBe(
      false,
    );
  });
  it("selects the sole suitable task automatically but still waits for explicit entry", async () => {
    const { requests } = start({ selectedTask: null });
    await screen.findByText("条件已满足，点击进入即可。");
    expect(
      screen
        .getByRole("button", { name: /机场巡检 · 待执行 · 可进入/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      requests.mock.calls.some(
        ([url]) =>
          url.includes("/flight-control/tasks?") &&
          url.includes("deviceId=source-device"),
      ),
    ).toBe(true);
    expect(launchCount(requests)).toBe(0);
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    await enter();
    expect(launchCount(requests)).toBe(1);
  });
  it("leaves multiple suitable tasks for the user to choose", async () => {
    const second = {
      ...allowed,
      taskId: "task-2",
      context: {
        ...allowed.context,
        task: { ...allowed.context.task, id: "task-2", title: "第二个任务" },
      },
    };
    const { requests } = start({
      selectedTask: null,
      candidates: [allowed, second],
    });
    await screen.findByText("选择一个任务，系统会自动检查进入条件。");
    const firstTask = await screen.findByRole("button", {
      name: /机场巡检 · 待执行 · 可进入/,
    });
    const secondTask = screen.getByRole("button", {
      name: /第二个任务 · 待执行 · 可进入/,
    });
    expect(
      within(firstTask).getByText("设备：机场一号 · 飞手：飞手"),
    ).toBeTruthy();
    expect(
      within(secondTask).getByText("设备：机场一号 · 飞手：飞手"),
    ).toBeTruthy();
    expect(
      requests.mock.calls.some(([url]) => url.includes("/preflight?")),
    ).toBe(false);
    fireEvent.click(firstTask);
    expect(firstTask.getAttribute("aria-pressed")).toBe("true");
    await enter();
    expect(launchCount(requests)).toBe(1);
  });
  it("offers a single flight application entry when no current task exists", async () => {
    const { navigate, requests } = start({
      selectedTask: null,
      candidates: [],
    });
    fireEvent.click(await screen.findByRole("button", { name: "申请飞行" }));
    expect(navigate).toHaveBeenCalledWith("services", { action: "apply" });
    expect(screen.queryByRole("button", { name: /执行任务/ })).toBeNull();
    expect(launchCount(requests)).toBe(0);
  });
  it("shows the assigned pilot and scheduling entry before opening check details", async () => {
    const { navigate } = start();
    const pilotLabel = await screen.findByText("关联飞手", { selector: "dt" });
    const pilotSummary = within(pilotLabel.parentElement!);
    expect(pilotSummary.getByText("飞手", { selector: "span" })).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    fireEvent.click(pilotSummary.getByRole("button", { name: "查看执行安排" }));
    expect(navigate).toHaveBeenCalledWith("dispatch", { taskId: "task-id" });
  });
  it.each([
    { role: "ADMIN", status: "PENDING_ASSIGNMENT", canAssign: true },
    { role: "DISPATCH", status: "PENDING_ASSIGNMENT", canAssign: true },
    { role: "PILOT", status: "PENDING_ASSIGNMENT", canAssign: false },
    { role: "ADMIN", status: "PENDING_EXECUTION", canAssign: false },
    { role: "DISPATCH", status: "PENDING_EXECUTION", canAssign: false },
    { role: "PILOT", status: "PENDING_EXECUTION", canAssign: false },
  ] as const)(
    "routes $role to the permitted pilot settings for $status",
    async ({ role, status, canAssign }) => {
      const { navigate } = start({
        initialUser: { ...user, role },
        check: {
          ...allowed,
          eligible: false,
          context: {
            ...allowed.context,
            pilot: null,
            task: { ...allowed.context.task, status },
          },
          checks: [
            {
              code: "PILOT_ASSIGNMENT",
              label: "执行飞手",
              passed: false,
              message: "尚未分配飞手",
              action: "TASK",
            },
          ],
        },
      });
      const pilotLabel = await screen.findByText("关联飞手", {
        selector: "dt",
      });
      const pilotSummary = within(pilotLabel.parentElement!);
      expect(pilotSummary.getByText("尚未分配")).toBeTruthy();
      expect(
        pilotSummary.queryByRole("button", {
          name: canAssign ? "查看执行安排" : "分配飞手",
        }),
      ).toBeNull();
      fireEvent.click(
        pilotSummary.getByRole("button", {
          name: canAssign ? "分配飞手" : "查看执行安排",
        }),
      );
      expect(navigate).toHaveBeenCalledWith(
        "dispatch",
        canAssign
          ? { taskId: "task-id", action: "assign" }
          : { taskId: "task-id" },
      );
    },
  );
  it.each(["ADMIN", "DISPATCH", "PILOT"] as const)(
    "explains pilot assignment and exposes task scheduling according to the %s role",
    async (role) => {
      const { navigate } = start({
        initialUser: { ...user, role },
        selectedTask: null,
        candidates: [],
      });
      await screen.findByText(
        "关联飞手由管理员或调度人员在“任务调度 → 分配资源”中设置。",
      );
      const scheduling = screen.queryByRole("button", { name: "前往任务调度" });
      if (role === "PILOT") {
        expect(scheduling).toBeNull();
      } else {
        expect(scheduling).not.toBeNull();
        fireEvent.click(scheduling!);
        expect(navigate).toHaveBeenCalledWith("dispatch", {});
      }
    },
  );
  it("keeps all 13 passing checks collapsed until details are requested", async () => {
    const check = {
      ...allowed,
      checks: Array.from({ length: 13 }, (_, index) => ({
        code: `CHECK_${index}`,
        label: `检查项目${index}`,
        passed: true,
        message: `检查通过说明${index}`,
      })),
    };
    start({ check });
    await screen.findByText("条件已满足，点击进入即可。");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "查看检查详情" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(13);
    fireEvent.click(screen.getByRole("button", { name: "收起检查详情" }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
  it("toggles expired candidates without replacing an explicitly selected old task", async () => {
    const old = {
      ...allowed,
      taskId: "old-task",
      eligible: false,
      checkedAt: "2026-10-21T06:00:00Z",
      context: {
        ...allowed.context,
        task: { ...allowed.context.task, id: "old-task" },
      },
      checks: [
        {
          code: "TASK_TIME",
          label: "执行时段",
          passed: false,
          message: "任务执行时段已结束",
          action: "TASK",
        },
      ],
    };
    const { requests } = start({
      check: old,
      selectedTask: "old-task",
      candidates: [allowed],
    });
    await screen.findByText("这个任务的执行时间已结束，请安排新的飞行。");
    expect(
      screen
        .getByRole("button", { name: /机场巡检 · 待执行 · 待完善/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      requests.mock.calls.some(([url]) => url.includes("includeExpired=false")),
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "查看已过期任务" }));
    await waitFor(() =>
      expect(
        requests.mock.calls.some(([url]) =>
          url.includes("includeExpired=true"),
        ),
      ).toBe(true),
    );
    expect(
      screen
        .getByRole("button", { name: /机场巡检 · 待执行 · 待完善/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(launchCount(requests)).toBe(0);
  });
  it.each([true, false])(
    "offers the correct expired-task remedy for plan validity (%s)",
    async (reusable) => {
      const expired = {
        ...allowed,
        eligible: false,
        checkedAt: "2026-10-21T06:00:00Z",
        context: {
          ...allowed.context,
          plan: {
            ...allowed.context.plan!,
            endAt: reusable ? "2026-10-22T06:00:00Z" : "2026-10-20T06:00:00Z",
          },
        },
        checks: [
          {
            code: "TASK_TIME",
            label: "执行时段",
            passed: false,
            message: "任务执行时段已结束",
            action: "TASK",
          },
        ],
      };
      const { navigate } = start({ check: expired });
      fireEvent.click(
        await screen.findByRole("button", {
          name: reusable ? "安排新任务" : "重新申请",
        }),
      );
      expect(navigate).toHaveBeenCalledWith("services", {
        action: "apply",
        planId: "plan-id",
      });
      expect(screen.queryByRole("button", { name: "进入飞控" })).toBeNull();
    },
  );
  it("shows one concrete assignment action with the remaining checks in details", async () => {
    const { navigate } = start({
      initialUser: { ...user, role: "ADMIN" },
      check: {
        ...allowed,
        eligible: false,
        context: {
          ...allowed.context,
          device: null,
          pilot: null,
          task: { ...allowed.context.task, status: "PENDING_ASSIGNMENT" },
        },
        checks: [
          {
            code: "DEVICE_ASSIGNMENT",
            label: "执行设备",
            passed: false,
            message: "没有设备",
            action: "RESOURCE",
          },
          {
            code: "PILOT_ASSIGNMENT",
            label: "执行飞手",
            passed: false,
            message: "没有飞手",
            action: "TASK",
          },
          ...allowed.checks,
        ],
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "分配设备和飞手" }),
    );
    expect(navigate).toHaveBeenCalledWith("dispatch", {
      taskId: "task-id",
      action: "assign",
    });
    expect(screen.queryByText("没有设备")).toBeNull();
    expect(screen.queryByRole("button", { name: "前往办理" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看检查详情" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
  it("directs pilots with unassigned tasks to execution details without offering resource assignment", async () => {
    const { navigate } = start({
      check: {
        ...allowed,
        eligible: false,
        context: {
          ...allowed.context,
          device: null,
          pilot: null,
          task: { ...allowed.context.task, status: "PENDING_ASSIGNMENT" },
        },
        checks: [
          {
            code: "PILOT_ASSIGNMENT",
            label: "执行飞手",
            passed: false,
            message: "没有飞手",
            action: "TASK",
          },
        ],
      },
    });
    await screen.findByText("这个任务还没有安排好设备和飞手。");
    expect(screen.queryByRole("button", { name: "分配设备和飞手" })).toBeNull();
    expect(screen.queryByRole("button", { name: "分配飞手" })).toBeNull();
    const issue = document.querySelector<HTMLElement>(
      ".flight-entry-primary-issue",
    )!;
    fireEvent.click(
      within(issue).getByRole("button", { name: "查看执行安排" }),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("dispatch", {
      taskId: "task-id",
    });
  });
  it("directs an inactive allocated device to its scheduling archive", async () => {
    const { navigate } = start({
      check: {
        ...allowed,
        eligible: false,
        context: {
          ...allowed.context,
          device: { ...allowed.context.device!, status: "MAINTENANCE" },
        },
        checks: [
          {
            code: "DEVICE_ASSIGNMENT",
            label: "执行设备",
            passed: false,
            message: "设备未启用",
            action: "RESOURCE",
          },
        ],
      },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "完善设备调度资料" }),
    );
    expect(navigate).toHaveBeenCalledWith("resources");
    expect(screen.queryByRole("button", { name: "分配设备和飞手" })).toBeNull();
  });
  it("keeps invalid execution assignments on task details outside the assignment stage", async () => {
    const { navigate } = start({
      check: {
        ...allowed,
        eligible: false,
        checks: [
          {
            code: "PILOT_ASSIGNMENT",
            label: "执行飞手",
            passed: false,
            message: "飞手账号已停用",
            action: "TASK",
          },
        ],
      },
    });
    await screen.findByText("设备或飞手的执行安排需要重新确认。");
    const issue = document.querySelector<HTMLElement>(
      ".flight-entry-primary-issue",
    )!;
    fireEvent.click(
      within(issue).getByRole("button", { name: "查看执行安排" }),
    );
    expect(navigate).toHaveBeenCalledWith("dispatch", { taskId: "task-id" });
    expect(screen.queryByRole("button", { name: "分配设备和飞手" })).toBeNull();
  });
  it("shows structured refusal and a plan handling entry without issuing a launch ticket", async () => {
    const { requests, navigate } = start({
      check: {
        ...allowed,
        eligible: false,
        checks: [
          {
            code: "APPROVAL",
            label: "计划审批",
            passed: false,
            message: "关联计划尚未审批通过。",
            action: "PLAN",
          },
        ],
      },
    });
    await screen.findByText("飞行申请尚未审批通过，暂时不能进入。");
    expect(screen.queryByRole("button", { name: "进入飞控" })).toBeNull();
    expect(screen.queryByText("关联计划尚未审批通过。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看审批进度" }));
    expect(navigate).toHaveBeenCalledWith("services", { planId: "plan-id" });
    expect(launchCount(requests)).toBe(0);
  });
  it.each(["direct", "local"] as const)(
    "rejects %s mode without original-site links or legacy fallback",
    async (mode) => {
      const { requests } = start({
        configuration: {
          mode,
          requiresTask: true,
          origin,
          directUrl: `${origin}/control-room`,
        },
      });
      await screen.findByText("当前接入方式不支持任务放行");
      expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
      expect(screen.queryByRole("link", { name: "打开飞控原站" })).toBeNull();
      expect(launchCount(requests)).toBe(0);
      expect(legacy).not.toHaveBeenCalled();
    },
  );
  it("rejects an older embedded configuration without task gating", async () => {
    start({ configuration: { mode: "embedded", origin } });
    await screen.findByText("当前接入方式不支持任务放行");
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
  });
  it("never mounts the old workspace or launches while configuration is pending", async () => {
    let complete!: (response: Response) => void;
    const { requests } = start({
      options: new Promise((resolve) => {
        complete = resolve;
      }),
    });
    expect(legacy).not.toHaveBeenCalled();
    await act(async () =>
      complete(reply({ mode: "embedded", origin, requiresTask: true })),
    );
    await screen.findByText("条件已满足，点击进入即可。");
    expect(launchCount(requests)).toBe(0);
  });
  it("only accepts readiness from the configured origin and exact iframe window", async () => {
    start();
    const frame = await enter();
    expect(frame.style.visibility).toBe("hidden");
    message(frame, "READY", frame.contentWindow, "https://evil.example.test");
    message(frame, "READY", window);
    expect(frame.style.visibility).toBe("hidden");
    message(frame, "READY");
    expect(frame.style.visibility).toBe("visible");
    message(frame, "ADAPTER_ERROR");
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    expect(screen.getByText(/上游页面结构可能已变化/)).toBeTruthy();
  });
  it("handles gateway document rejection as business recheck without a login reset", async () => {
    start();
    const frame = await enter();
    message(frame, "READY");
    message(frame, "ENTRY_DENIED");
    await screen.findByRole("button", { name: "重新检查任务" });
    expect(screen.queryByRole("link", { name: "4A 统一登录" })).toBeNull();
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
  });
  it("handles final upstream permission refusal locally without a raw-site fallback", async () => {
    const { requests } = start({ launchStatus: 403 });
    fireEvent.click(await screen.findByRole("button", { name: "进入飞控" }));
    await screen.findByText("当前账号无飞控权限");
    expect(launchCount(requests)).toBe(1);
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    expect(screen.queryByRole("link", { name: /4A 统一登录/ })).toBeNull();
  });
  it("offers official 4A login with the selected task when final authentication fails", async () => {
    start({ launchStatus: 401, launchCode: "FOUR_A_LOGIN_REQUIRED" });
    fireEvent.click(await screen.findByRole("button", { name: "进入飞控" }));
    const login = await screen.findByRole("link", { name: "4A 统一登录" });
    expect(login.getAttribute("href")).toBe(
      "/api/v1/auth/4a/start?view=flight&deviceId=source-device&taskId=task-id",
    );
  });
  it.each([
    {
      url: "https://evil.example.test/__oneflight/bootstrap?ticket=short",
      origin,
    },
    {
      url: `${origin}/__oneflight/bootstrap?ticket=first&ticket=second`,
      origin,
    },
    {
      url: `${origin}/__oneflight/bootstrap?ticket=short&token=personal`,
      origin,
    },
  ])("rejects an untrusted bootstrap URL", async (launch) => {
    start({ launch });
    fireEvent.click(await screen.findByRole("button", { name: "进入飞控" }));
    await screen.findByText("飞控启动地址无效，请联系管理员");
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
  });
  it("supports the configured HTTP IP pair, native fullscreen, and no microphone permission", async () => {
    const child = "http://192.0.2.20:8089";
    start({
      configuration: {
        mode: "embedded",
        requiresTask: true,
        transportMode: "http-ip",
        origin: child,
        parentOrigin: window.location.origin,
        capabilities: { microphone: false },
        message: HTTP_FLIGHT_NOTICE,
      },
      launch: {
        url: `${child}/__oneflight/bootstrap?ticket=http-ticket`,
        origin: child,
        message: "设备类型尚未验证，请手动选择设备。",
      },
    });
    const frame = await enter();
    expect(frame.getAttribute("allow")).toBe("fullscreen; autoplay");
    expect(screen.getAllByText(/HTTP 兼容模式/)).toHaveLength(1);
    expect(screen.getByRole("note").textContent).toContain("手动选择设备");
    message(frame, "READY", frame.contentWindow, child);
    const full = vi.fn().mockResolvedValue(undefined);
    frame.requestFullscreen = full;
    fireEvent.click(screen.getByRole("button", { name: "飞控全屏" }));
    expect(full).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "展开任务信息" }));
    expect(screen.getByTitle("牍术飞控操作区")).toBe(frame);
  });
  it("rejects an HTTP child without the explicit transport mode", async () => {
    const { requests } = start({
      configuration: {
        mode: "embedded",
        requiresTask: true,
        origin: "http://192.0.2.20:8089",
      },
    });
    await screen.findByText("飞控独立入口配置不正确，请联系管理员");
    expect(launchCount(requests)).toBe(0);
  });
  it.each([false, true])(
    "grants approved HTTPS microphone only in a secure context (%s)",
    async (secure) => {
      vi.stubGlobal("isSecureContext", secure);
      start({
        configuration: {
          mode: "embedded",
          origin,
          requiresTask: true,
          capabilities: { microphone: true },
        },
      });
      const frame = await enter();
      expect(frame.getAttribute("allow")?.includes("microphone")).toBe(secure);
    },
  );
  it("keeps the same native document after task expiry and local business permission changes", async () => {
    let poll!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
    ) => {
      if (delay === 30_000) poll = handler as () => void;
      return 999;
    }) as typeof window.setInterval);
    const { requests, setCheck, setUser } = start();
    const frame = await enter();
    message(frame, "READY");
    const url = frame.src;
    setCheck({
      ...allowed,
      eligible: false,
      checks: [
        {
          code: "WINDOW",
          label: "执行时段",
          passed: false,
          message: "任务已超过执行时段。",
        },
      ],
    });
    await act(async () => poll());
    await screen.findByText(/任务已超过执行时段/);
    expect(screen.getByTitle("牍术飞控操作区")).toBe(frame);
    expect(frame.src).toBe(url);
    setUser({ ...user, businessAccessAssigned: false, role: "DEPARTMENT" });
    await screen.findByText(/平台业务权限已变化/);
    expect(screen.getByTitle("牍术飞控操作区")).toBe(frame);
    expect(frame.src).toBe(url);
    expect(launchCount(requests)).toBe(1);
  });
  it.each([403, 404])(
    "keeps the opened iframe after a preflight %s business refusal",
    async (status) => {
      let poll!: () => void;
      vi.spyOn(window, "setInterval").mockImplementation(((
        handler: TimerHandler,
        delay?: number,
      ) => {
        if (delay === 30_000) poll = handler as () => void;
        return 999;
      }) as typeof window.setInterval);
      const { setCheck } = start();
      const frame = await enter();
      message(frame, "READY");
      setCheck(allowed, status);
      await act(async () => poll());
      await screen.findByRole("alert");
      expect(screen.getByTitle("牍术飞控操作区")).toBe(frame);
    },
  );
  it("pauses business checks in a hidden page and resumes without relaunching on visibility", async () => {
    let poll!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
    ) => {
      if (delay === 30_000) poll = handler as () => void;
      return 999;
    }) as typeof window.setInterval);
    const { requests } = start();
    const frame = await enter();
    message(frame, "READY");
    const before = requests.mock.calls.filter(([url]) =>
      url.includes("/preflight?"),
    ).length;
    const visible = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    await act(async () => poll());
    expect(
      requests.mock.calls.filter(([url]) => url.includes("/preflight?")),
    ).toHaveLength(before);
    visible.mockReturnValue("visible");
    await act(async () =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect(
      requests.mock.calls.filter(([url]) => url.includes("/preflight?")),
    ).toHaveLength(before + 1);
    expect(screen.getByTitle("牍术飞控操作区")).toBe(frame);
    expect(launchCount(requests)).toBe(1);
  });
  it("removes the document when identity authentication expires", async () => {
    let poll!: () => void;
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      delay?: number,
    ) => {
      if (delay === 30_000) poll = handler as () => void;
      return 999;
    }) as typeof window.setInterval);
    const { setCheck } = start();
    const frame = await enter();
    message(frame, "READY");
    setCheck(allowed, 401);
    await act(async () => poll());
    await screen.findByRole("link", { name: "4A 统一登录" });
    expect(frame.isConnected).toBe(false);
  });
  it("does not request tasks for a pending business account", async () => {
    const { requests } = start({
      initialUser: { ...user, businessAccessAssigned: false },
    });
    await screen.findByText("尚无飞控入口业务权限");
    expect(
      requests.mock.calls.some(([url]) =>
        url.includes("/flight-control/tasks"),
      ),
    ).toBe(false);
    expect(launchCount(requests)).toBe(0);
  });
});
