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
import type { Entity } from "../api";
import FourAAccountPicker, { type FourAAccount } from "./FourAAccountPicker";

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

const account: FourAAccount = {
  externalUserId: "external-pilot",
  username: "pilot",
  displayName: "目录飞手",
  externalGroupName: "4A 飞行组织",
  available: true,
  unavailableReason: "",
  linked: false,
  businessAccessAssigned: false,
};
const reply = (data: unknown) =>
  new Response(JSON.stringify({ code: "SUCCESS", data }));
const page = (items: FourAAccount[], total = items.length, current = 1) =>
  reply({ items, total, page: current, pageSize: 20 });

function start(
  directory: (params: URLSearchParams) => Response | Promise<Response> = () =>
    page([account]),
  link: () => Response | Promise<Response> = () =>
    reply({
      id: "user-profile",
      username: "pilot",
      businessAccessAssigned: false,
    }),
) {
  const linked = vi.fn<(account: Entity) => void>();
  const request = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/users/4a-directory?"))
      return directory(new URL(url, "http://localhost").searchParams);
    if (url.endsWith("/auth/csrf"))
      return reply({ token: "csrf", headerName: "X-CSRF-TOKEN" });
    if (url.endsWith("/users/4a-link") && options?.method === "POST")
      return link();
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", request);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <FourAAccountPicker onClose={vi.fn()} onLinked={linked} />
    </QueryClientProvider>,
  );
  return { request, linked };
}

describe("4A account directory", () => {
  it("searches the backend and clears an earlier selection when paging or searching", async () => {
    const directory = vi.fn((params: URLSearchParams) =>
      params.get("query")
        ? page([
            {
              ...account,
              externalUserId: "search-result",
              displayName: "关键词结果",
            },
          ])
        : params.get("page") === "2"
          ? page(
              [
                {
                  ...account,
                  externalUserId: "page-2",
                  displayName: "第二页飞手",
                },
              ],
              21,
              2,
            )
          : page([account], 21),
    );
    const { request } = start(directory);
    fireEvent.click(
      await screen.findByRole("radio", { name: "选择 目录飞手（pilot）" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "关联并配置权限",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await screen.findByText("第二页飞手");
    expect(screen.queryByText("目录飞手")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "关联并配置权限",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("共 21 个账号 · 第 2 / 2 页")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 4A 账号" }), {
      target: { value: " 张三 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await screen.findByText("关键词结果");
    expect(screen.getByText("共 1 个账号 · 第 1 / 1 页")).toBeTruthy();
    const directoryCalls = request.mock.calls.filter(([url]) =>
      url.includes("/users/4a-directory?"),
    );
    expect(
      directoryCalls.map(([url]) =>
        new URL(url, "http://localhost").searchParams.get("page"),
      ),
    ).toEqual(["1", "2", "1"]);
    expect(
      new URL(directoryCalls.at(-1)![0], "http://localhost").searchParams.get(
        "query",
      ),
    ).toBe("张三");
    expect(directoryCalls.every(([url]) => url.includes("pageSize=20"))).toBe(
      true,
    );
    expect(
      directoryCalls.every(
        ([, options]) => !options?.method || options.method === "GET",
      ),
    ).toBe(true);
  });

  it("shows linked state and unavailable reasons without allowing unavailable accounts to be linked", async () => {
    const { request } = start(() =>
      page([
        { ...account, available: false, unavailableReason: "4A 账号已停用" },
        {
          ...account,
          externalUserId: "already-linked",
          username: "existing",
          displayName: "已关联飞手",
          linked: true,
          businessAccessAssigned: true,
        },
      ]),
    );
    const unavailable = await screen.findByRole("radio", {
      name: "选择 目录飞手（pilot）",
    });
    expect((unavailable as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("4A 账号已停用")).toBeTruthy();
    fireEvent.click(unavailable);
    expect(
      (
        screen.getByRole("button", {
          name: "关联并配置权限",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("已关联")).toBeTruthy();
    expect(screen.getByText("已配置业务权限")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("radio", { name: "选择 已关联飞手（existing）" }),
    );
    expect(screen.getByRole("button", { name: "配置权限" })).toBeTruthy();
    expect(request.mock.calls.some(([url]) => url.endsWith("/4a-link"))).toBe(
      false,
    );
  });

  it("explains a missing directory configuration and retries without fabricated candidates", async () => {
    let configured = false;
    start(() =>
      configured
        ? page([account])
        : new Response(
            JSON.stringify({
              code: "FOUR_A_DIRECTORY_NOT_CONFIGURED",
              message: "尚未配置 4A 账号目录接口",
            }),
            { status: 503 },
          ),
    );
    await screen.findByText("尚未配置 4A 账号目录接口");
    expect(screen.getByText("4A 账号目录暂不可用")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    configured = true;
    fireEvent.click(screen.getByRole("button", { name: "重试加载 4A 目录" }));
    await screen.findByRole("radio", { name: "选择 目录飞手（pilot）" });
    expect(screen.queryByText("尚未配置 4A 账号目录接口")).toBeNull();
  });

  it("keeps association failures reviewable and allows a retry with only the external identity ID", async () => {
    let available = false;
    const linkedAccount = {
      id: "user-profile",
      username: "pilot",
      businessAccessAssigned: false,
    };
    const { request, linked } = start(undefined, () =>
      available
        ? reply(linkedAccount)
        : new Response(
            JSON.stringify({
              code: "FOUR_A_UNAVAILABLE",
              message: "4A 服务连接失败，请重试",
            }),
            { status: 502 },
          ),
    );
    fireEvent.click(
      await screen.findByRole("radio", { name: "选择 目录飞手（pilot）" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "关联并配置权限" }));
    await screen.findByText("4A 服务连接失败，请重试");
    expect(linked).not.toHaveBeenCalled();
    available = true;
    fireEvent.click(screen.getByRole("button", { name: "关联并配置权限" }));
    await waitFor(() => expect(linked).toHaveBeenCalledWith(linkedAccount));
    const links = request.mock.calls.filter(([url]) =>
      url.endsWith("/users/4a-link"),
    );
    expect(links).toHaveLength(2);
    expect(
      links.map(([, options]) => JSON.parse(String(options?.body))),
    ).toEqual([
      { externalUserId: "external-pilot" },
      { externalUserId: "external-pilot" },
    ]);
  });
});
