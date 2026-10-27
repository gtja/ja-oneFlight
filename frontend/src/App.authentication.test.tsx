// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { CurrentUser } from "./api";
import { FLIGHT_NAMESPACE } from "./flightEmbedding";
import type { FlightControlOptions } from "./flightEmbedding";

vi.mock("./pages/Overview", () => ({ default: () => <div>overview</div> }));
vi.mock("./pages/CommandBoard", () => ({ default: () => null }));
vi.mock("./pages/Tasks", () => ({ default: () => null }));
vi.mock("./pages/Flight", () => ({ default: () => <div>legacy-flight</div> }));
vi.mock("./pages/Services", () => ({ default: () => null }));
vi.mock("./pages/Resources", () => ({ default: () => null }));
vi.mock("./pages/Algorithms", () => ({ default: () => null }));
vi.mock("./pages/Scenes", () => ({ default: () => null }));
vi.mock("./pages/Settings", () => ({
  default: ({ initialTab }: { initialTab: string }) => (
    <div>settings:{initialTab}</div>
  ),
}));

const baseUser: CurrentUser = {
  id: "local-A",
  username: "admin",
  displayName: "管理员",
  role: "ADMIN",
  organizationId: "org",
  regions: [],
  deviceIds: [],
};
const origin = "https://flight.example.test";
const entry = {
  taskId: "task-1",
  eligible: true,
  checkedAt: "2026-10-21T03:00:00Z",
  context: {
    task: {
      id: "task-1",
      title: "机场巡检",
      status: "PENDING_EXECUTION",
      startAt: "2026-10-21T02:00:00Z",
      endAt: "2026-10-21T04:00:00Z",
    },
    plan: { id: "plan-1", title: "巡检计划", status: "APPROVED" },
    device: { id: "device-1", title: "机场一号" },
    pilot: { id: "local-A", displayName: "管理员" },
  },
  checks: [
    {
      code: "APPROVAL",
      label: "计划审批",
      passed: true,
      message: "已审批通过",
    },
  ],
};
const clients: QueryClient[] = [];
const reply = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      code: status === 200 ? "SUCCESS" : "UNAUTHENTICATED",
      message: "请先登录",
      data,
    }),
    { status },
  );
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function start(
  route = "/?view=flight",
  initialUser: CurrentUser | null = baseUser,
  flightConfiguration: FlightControlOptions = {
    mode: "embedded",
    origin,
    requiresTask: true,
  },
) {
  let user: CurrentUser | undefined = initialUser || undefined;
  const request = vi.fn(async (url: string) => {
    if (url.endsWith("/auth/options"))
      return reply({
        mode: "4a",
        accountsMode: "4a",
        localLoginEnabled: false,
      });
    if (url.endsWith("/auth/me")) return reply(user, user ? 200 : 401);
    if (url.endsWith("/auth/csrf"))
      return reply({ token: "csrf", headerName: "X-CSRF-TOKEN" });
    if (url.endsWith("/flight-control/options"))
      return reply(flightConfiguration);
    if (url.includes("/flight-control/tasks?"))
      return reply({ items: [entry], total: 1, page: 1, pageSize: 20 });
    if (url.includes("/flight-control/preflight?")) return reply(entry);
    if (url.endsWith("/flight-control/launch"))
      return reply({
        url: `${origin}/__oneflight/bootstrap?ticket=short-${user?.id}`,
        origin,
      });
    if (url.endsWith("/auth/logout")) {
      user = undefined;
      return reply({
        externalLogoutSucceeded: false,
        message: "平台已退出，4A 注销暂未成功。",
      });
    }
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", request);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {
    request,
    client,
    setUser: (next: CurrentUser | undefined) => {
      user = next;
    },
  };
}
async function confirmEntry() {
  await screen.findByRole("button", { name: /机场巡检 · 待执行/ });
  const confirm = await screen.findByRole("button", {
    name: "进入飞控",
  });
  await waitFor(() => expect(confirm.hasAttribute("disabled")).toBe(false));
  fireEvent.click(confirm);
  return (await screen.findByTitle("牍术飞控操作区")) as HTMLIFrameElement;
}
function send(frame: HTMLIFrameElement, type: string) {
  act(() =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source: frame.contentWindow,
        data: { namespace: FLIGHT_NAMESPACE, type },
      }),
    ),
  );
}
describe("application authentication integration", () => {
  it("clears the previous native iframe and requires new confirmation when the platform account changes", async () => {
    const { request, client, setUser } = start();
    const first = await confirmEntry();
    expect(first.src).toContain("short-local-A");
    const authenticationOptions = client.getQueryData(["auth-options"]);
    client.setQueryData(["account-private-records"], { ownerId: baseUser.id });
    const secondUser = { ...baseUser, id: "local-B", username: "second" };
    setUser(secondUser);
    act(() => client.setQueryData(["current-user"], secondUser));
    await screen.findByRole("button", { name: /机场巡检 · 待执行/ });
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    expect(
      request.mock.calls.filter(([url]) =>
        url.endsWith("/flight-control/launch"),
      ),
    ).toHaveLength(1);
    const second = await confirmEntry();
    expect(second.src).toContain("short-local-B");
    expect(client.getQueryData(["account-private-records"])).toBeUndefined();
    expect(client.getQueryData(["auth-options"])).toBe(authenticationOptions);
    expect(client.getQueryData<CurrentUser>(["current-user"])?.id).toBe(
      "local-B",
    );
    expect(first.isConnected).toBe(false);
    expect(
      request.mock.calls.filter(([url]) =>
        url.endsWith("/flight-control/launch"),
      ),
    ).toHaveLength(2);
  });
  it("clears the native child before logging out and displays external logout failure", async () => {
    const { request } = start();
    const frame = await confirmEntry();
    send(frame, "READY");
    fireEvent.click(document.querySelector(".user-menu > button")!);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(
      request.mock.calls.filter(([url]) => url.endsWith("/auth/logout")),
    ).toHaveLength(0);
    send(frame, "LOGGED_OUT");
    await screen.findByText("平台已退出，4A 注销暂未成功。");
    expect(
      request.mock.calls.filter(([url]) => url.endsWith("/auth/logout")),
    ).toHaveLength(1);
    expect(screen.getByRole("link", { name: /4A 统一登录/ })).toBeTruthy();
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
  });
  it("a native logout also ends the local platform session without requiring another child acknowledgement", async () => {
    const { request } = start();
    const frame = await confirmEntry();
    send(frame, "LOGGED_OUT");
    await screen.findByRole("link", { name: /4A 统一登录/ });
    expect(
      request.mock.calls.filter(([url]) => url.endsWith("/auth/logout")),
    ).toHaveLength(1);
  });
  it("rejects the direct native mode and still permits platform logout", async () => {
    const { request } = start("/?view=flight", baseUser, {
      mode: "direct",
      origin,
      directUrl: `${origin}/control-room`,
    });
    await screen.findByText("当前接入方式不支持任务放行");
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    fireEvent.click(document.querySelector(".user-menu > button")!);
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await screen.findByText("平台已退出，4A 注销暂未成功。");
    expect(
      request.mock.calls.some(([url]) =>
        url.endsWith("/flight-control/launch"),
      ),
    ).toBe(false);
  });
  it("does not open a manual identity manager for legacy binding callback parameters", async () => {
    start("/?view=settings&authVerified=1");
    await screen.findByText("overview");
    expect(screen.queryByText("settings:identities")).toBeNull();
  });
  it("falls back to overview content, heading and navigation for an unknown view", async () => {
    start("/?view=unknown-view");
    await screen.findByText("overview");
    expect(screen.getByRole("button", { name: "态势感知" }).className).toBe(
      "active",
    );
    expect(document.querySelector(".brand > span")?.textContent).toBe(
      "态势感知",
    );
  });
  it("keeps the intended flight target on the official login link after session expiry", async () => {
    start("/?view=flight&deviceId=source-1&taskId=task-2", null);
    const login = await screen.findByRole("link", { name: /4A 统一登录/ });
    expect(login.getAttribute("href")).toBe(
      "/api/v1/auth/4a/start?view=flight&deviceId=source-1&taskId=task-2",
    );
  });
  it("requires platform business permission before task-gated flight entry", async () => {
    const { request } = start("/?view=overview", {
      ...baseUser,
      role: "PILOT",
      businessAccessAssigned: false,
    });
    await screen.findByText("已通过 4A 登录");
    expect(screen.queryByText("overview")).toBeNull();
    expect(
      request.mock.calls.some(([url]) =>
        url.endsWith("/flight-control/launch"),
      ),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "进入飞行管控" })).toBeNull();
    expect(screen.queryByRole("button", { name: "刷新业务权限" })).toBeNull();
    fireEvent.click(document.querySelector(".user-menu > button")!);
    expect(screen.queryByRole("button", { name: "权限管理" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "飞行管控" }));
    await screen.findByText("尚无飞控入口业务权限");
    expect(screen.queryByTitle("牍术飞控操作区")).toBeNull();
    expect(
      request.mock.calls.some(([url]) =>
        url.endsWith("/flight-control/launch"),
      ),
    ).toBe(false);
  });
  it("retains the opened frame when local business access is revoked on current-user refresh", async () => {
    const { client } = start();
    const frame = await confirmEntry();
    send(frame, "READY");
    act(() =>
      client.setQueryData(["current-user"], {
        ...baseUser,
        role: "DEPARTMENT",
        businessAccessAssigned: false,
      }),
    );
    await screen.findByText(/平台业务权限已变化/);
    expect(screen.getByTitle("牍术飞控操作区")).toBe(frame);
    expect(frame.isConnected).toBe(true);
  });
  it("opens the platform permission manager directly from the administrator menu", async () => {
    start("/?view=overview");
    await screen.findByText("overview");
    fireEvent.click(document.querySelector(".user-menu > button")!);
    fireEvent.click(screen.getByRole("button", { name: "权限管理" }));
    await screen.findByText("settings:users");
    expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();
  });
});
