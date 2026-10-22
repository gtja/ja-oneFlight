// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserContext } from "../context";
import type { CurrentUser } from "../api";
import Settings from "./Settings";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function start(
  mode: "local" | "4a" = "4a",
  businessAccessAssigned = true,
  role: CurrentUser["role"] = "ADMIN",
  authUnavailable = false,
) {
  const user: CurrentUser = {
    id: "admin-profile",
    username: "4a-admin",
    displayName: "平台管理员",
    role,
    organizationId: "org",
    regions: [],
    deviceIds: [],
    businessAccessAssigned: true,
  };
  const account = {
    id: "user-profile",
    username: "4a-pilot",
    displayName: "4A 飞手",
    role: "PILOT",
    organizationId: "org",
    regions: ["西湖区"],
    deviceIds: ["device-1"],
    organizationIds: [],
    enabled: true,
    identitySource: "4a",
    businessAccessAssigned,
  };
  const reply = (data: unknown) =>
    new Response(JSON.stringify({ code: "SUCCESS", data }));
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/options"))
      return authUnavailable
        ? new Response(
            JSON.stringify({
              code: "AUTH_UNAVAILABLE",
              message: "登录配置读取失败",
            }),
            { status: 503 },
          )
        : reply({
            mode,
            accountsMode: mode,
            localLoginEnabled: mode === "local",
          });
    if (url.endsWith("/auth/csrf"))
      return reply({ token: "csrf", headerName: "X-CSRF-TOKEN" });
    if (url.includes("/users/4a-directory?"))
      return reply({
        total: 2,
        page: 1,
        pageSize: 20,
        items: [
          {
            externalUserId: "external-new-pilot",
            username: "new-pilot",
            displayName: "未登录飞手",
            externalGroupName: "4A 来源组织",
            available: true,
            unavailableReason: "",
            linked: false,
            businessAccessAssigned: false,
          },
          {
            externalUserId: "external-existing-pilot",
            username: account.username,
            displayName: account.displayName,
            externalGroupName: "4A 来源组织",
            available: true,
            unavailableReason: "",
            linked: true,
            userId: account.id,
            businessAccessAssigned: account.businessAccessAssigned,
          },
        ],
      });
    if (url.endsWith("/users/4a-link") && options?.method === "POST") {
      const body = JSON.parse(String(options.body));
      return reply(
        body.externalUserId === "external-existing-pilot"
          ? account
          : {
              ...account,
              id: "new-pilot-profile",
              username: "new-pilot",
              displayName: "未登录飞手",
              role: "DEPARTMENT",
              organizationId: "pending-organization-placeholder",
              regions: [],
              deviceIds: [],
              businessAccessAssigned: false,
            },
      );
    }
    if (url.includes("/users?"))
      return reply({ total: 1, items: [account], page: 1, pageSize: 100 });
    if (url.includes("/organizations?"))
      return reply({
        total: 1,
        items: [{ id: "org", title: "平台业务组织" }],
        page: 1,
        pageSize: 100,
      });
    if (url.includes("/resources?"))
      return reply({ total: 0, items: [], page: 1, pageSize: 100 });
    if (/\/users\/[^/]+\/permissions$/.test(url) && options?.method === "PUT")
      return reply(null);
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", request);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <UserContext.Provider value={user}>
        <Settings initialTab="users" />
      </UserContext.Provider>
    </QueryClientProvider>,
  );
  return request;
}

describe("4A identity and independent platform business access", () => {
  it("offers direct 4A association without requiring a previous platform login", async () => {
    start();
    await screen.findByText("4A 飞手");
    expect(screen.queryByRole("button", { name: "新增账号" })).toBeNull();
    expect(screen.queryByRole("button", { name: "4A 身份绑定" })).toBeNull();
    expect(screen.getByRole("button", { name: "新增组织" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "关联 4A 账号" })).toBeTruthy();
    expect(screen.getByText(/无需该账号先登录本平台/)).toBeTruthy();
    expect(screen.getByText(/应用登录权限仍由 4A 管理/)).toBeTruthy();
  });
  it("edits platform roles and scopes without sending identity or password fields", async () => {
    const request = start();
    fireEvent.click(await screen.findByText("4A 飞手"));
    await screen.findByRole("dialog", { name: "配置平台业务权限" });
    expect(screen.queryByLabelText(/登录账号/)).toBeNull();
    expect(screen.queryByLabelText(/姓名/)).toBeNull();
    expect(screen.queryByLabelText(/密码/)).toBeNull();
    expect(screen.getByLabelText(/岗位角色/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/授权设备 ID/), {
      target: { value: "device-2,device-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(([url]) =>
          url.endsWith("/users/user-profile/permissions"),
        ),
      ).toBe(true),
    );
    const call = request.mock.calls.find(([url]) =>
      url.endsWith("/users/user-profile/permissions"),
    )!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      role: "PILOT",
      organizationId: "org",
      regions: ["西湖区"],
      deviceIds: ["device-2", "device-3"],
      organizationIds: [],
      enabled: true,
    });
  });
  it("retains local account creation only in explicit local mode", async () => {
    start("local");
    await screen.findByRole("button", { name: "新增账号" });
    expect(screen.queryByRole("button", { name: "关联 4A 账号" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    expect(screen.getByLabelText(/登录账号/)).toBeTruthy();
    expect(screen.getByLabelText(/初始密码/)).toBeTruthy();
  });
  it("normalizes all business scopes with both commas while preserving external IDs, order and duplicates", async () => {
    const request = start();
    fireEvent.click(await screen.findByText("4A 飞手"));
    await screen.findByRole("dialog", { name: "配置平台业务权限" });
    fireEvent.change(screen.getByLabelText(/可见 \/ 执行区域/), {
      target: { value: " 西湖区， ，余杭区,西湖区 " },
    });
    fireEvent.change(screen.getByLabelText(/授权设备 ID/), {
      target: { value: " 9223372036854775807，device-2,,9223372036854775807 " },
    });
    fireEvent.change(screen.getByLabelText(/运营可见组织ID/), {
      target: { value: " org-2， , org-3 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(([url]) =>
          url.endsWith("/users/user-profile/permissions"),
        ),
      ).toBe(true),
    );
    const call = request.mock.calls.find(([url]) =>
      url.endsWith("/users/user-profile/permissions"),
    )!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      role: "PILOT",
      organizationId: "org",
      regions: ["西湖区", "余杭区", "西湖区"],
      deviceIds: ["9223372036854775807", "device-2", "9223372036854775807"],
      organizationIds: ["org-2", "org-3"],
      enabled: true,
    });
  });
  it("links an account that has never logged in and opens its business permissions with no default role", async () => {
    const request = start();
    fireEvent.click(
      await screen.findByRole("button", { name: "关联 4A 账号" }),
    );
    fireEvent.click(
      await screen.findByRole("radio", {
        name: "选择 未登录飞手（new-pilot）",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "关联并配置权限" }));
    await screen.findByRole("dialog", { name: "配置平台业务权限" });
    expect(screen.queryByRole("dialog", { name: "关联 4A 账号" })).toBeNull();
    expect(screen.getByText(/正在为 未登录飞手（new-pilot）/)).toBeTruthy();
    expect(screen.getByLabelText(/岗位角色/).textContent).toContain("请选择");
    expect(screen.queryByLabelText(/登录账号/)).toBeNull();
    expect(screen.queryByLabelText(/密码/)).toBeNull();
    const linkCall = request.mock.calls.find(([url]) =>
      url.endsWith("/users/4a-link"),
    )!;
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({
      externalUserId: "external-new-pilot",
    });
    fireEvent.click(screen.getByLabelText(/岗位角色/));
    fireEvent.click(screen.getByRole("option", { name: "执行飞手" }));
    expect(screen.getByLabelText(/所属组织/).getAttribute("data-value")).toBe(
      "",
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择所属组织");
    expect(
      request.mock.calls.some(([url]) => url.endsWith("/permissions")),
    ).toBe(false);
    fireEvent.click(screen.getByLabelText(/所属组织/));
    fireEvent.click(screen.getByRole("option", { name: "平台业务组织" }));
    fireEvent.change(screen.getByLabelText(/授权设备 ID/), {
      target: { value: "device-2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(([url]) =>
          url.endsWith("/users/new-pilot-profile/permissions"),
        ),
      ).toBe(true),
    );
    const permissionCall = request.mock.calls.find(([url]) =>
      url.endsWith("/users/new-pilot-profile/permissions"),
    )!;
    expect(JSON.parse(String(permissionCall[1]?.body))).toEqual({
      role: "PILOT",
      organizationId: "org",
      regions: [],
      deviceIds: ["device-2"],
      organizationIds: [],
      enabled: true,
    });
  });
  it("opens an already linked account with its existing business permission scopes intact", async () => {
    const request = start();
    fireEvent.click(
      await screen.findByRole("button", { name: "关联 4A 账号" }),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: "选择 4A 飞手（4a-pilot）" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "配置权限" }));
    await screen.findByRole("dialog", { name: "配置平台业务权限" });
    expect(screen.getByLabelText(/岗位角色/).textContent).toContain("飞手");
    expect(screen.getByLabelText(/所属组织/).textContent).toContain(
      "平台业务组织",
    );
    expect(
      (screen.getByLabelText(/可见 \/ 执行区域/) as HTMLInputElement).value,
    ).toBe("西湖区");
    expect(
      (screen.getByLabelText(/授权设备 ID/) as HTMLInputElement).value,
    ).toBe("device-1");
    const linkCall = request.mock.calls.find(([url]) =>
      url.endsWith("/users/4a-link"),
    )!;
    expect(JSON.parse(String(linkCall[1]?.body))).toEqual({
      externalUserId: "external-existing-pilot",
    });
    expect(
      request.mock.calls.some(([url]) => url.endsWith("/permissions")),
    ).toBe(false);
  });
  it("does not expose association or permission write actions to dispatchers", async () => {
    const request = start("4a", true, "DISPATCH");
    fireEvent.click(await screen.findByText("4A 飞手"));
    expect(screen.queryByRole("button", { name: "关联 4A 账号" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      request.mock.calls.some(
        ([url]) => url.includes("4a-directory") || url.endsWith("4a-link"),
      ),
    ).toBe(false);
  });
  it("keeps account writes unavailable when the authentication mode cannot be read", async () => {
    const request = start("4a", true, "ADMIN", true);
    await screen.findByText("登录配置读取失败，账号管理暂不可用。");
    expect(screen.queryByRole("button", { name: "关联 4A 账号" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新增账号" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "重试读取登录配置" }),
    ).toBeTruthy();
    expect(
      request.mock.calls.some(([url]) => url.includes("4a-directory")),
    ).toBe(false);
  });
  it("requires the administrator to choose a business role for a new 4A identity", async () => {
    const request = start("4a", false);
    fireEvent.click(await screen.findByText("4A 飞手"));
    expect(screen.getByLabelText(/岗位角色/).textContent).toContain("请选择");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择岗位角色");
    expect(
      request.mock.calls.some(([url]) => url.endsWith("/permissions")),
    ).toBe(false);
  });
});
