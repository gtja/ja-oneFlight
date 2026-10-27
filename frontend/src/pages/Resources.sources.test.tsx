// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Entity } from "../api";
import { UserContext } from "../context";
import Resources from "./Resources";

vi.mock("../components/GeometryInput", () => ({ default: () => null }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
const localPerson: Entity = {
  id: "local-person",
  title: "本地登记人员",
  kind: "PERSON",
  status: "ACTIVE",
  organizationId: "business-org",
};
const sourceRecords: Record<string, Entity[]> = {
  people: [
    {
      id: "source-person",
      title: "来源人员档案",
      sourceSystem: "ja-4a",
      sourceStatus: "ENABLED",
      sourceOrganizationName: "来源组织",
      qualificationStatus: "UNKNOWN",
    },
  ],
  routes: [
    {
      id: "source-route",
      title: "来源航线模板",
      sourceSystem: "dushu",
      sourceStatus: "VALID",
      geometryStatus: "AVAILABLE",
    },
  ],
  airspaces: [
    {
      id: "source-zone",
      title: "来源电子围栏",
      sourceSystem: "chingchi-icos",
      sourceStatus: "VISIBLE",
      sourceDeviceIds: "source-device-1,source-device-2",
    },
  ],
};
function start(role: CurrentUser["role"] = "ADMIN", failingSource?: string) {
  const requests: URL[] = [];
  const user: CurrentUser = {
    id: "operator",
    username: "operator",
    displayName: "操作人员",
    role,
    organizationId: "business-org",
    regions: [],
    deviceIds: [],
  };
  const page = (items: Entity[]) =>
    new Response(
      JSON.stringify({
        code: "SUCCESS",
        data: { items, total: items.length, page: 1, pageSize: 100 },
      }),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      requests.push(url);
      if (url.pathname === "/api/v1/devices") return page([]);
      if (url.pathname === "/api/v1/organizations")
        return page([{ id: "business-org", title: "业务组织" }]);
      if (url.pathname === "/api/v1/resources")
        return page(
          url.searchParams.get("kind") === "PERSON" ? [localPerson] : [],
        );
      if (url.pathname.startsWith("/api/v1/source-data/")) {
        const source = url.pathname.split("/").at(-1)!;
        if (source === failingSource)
          return new Response(
            JSON.stringify({
              code: "SOURCE_UNAVAILABLE",
              message: "来源目录读取失败，请检查连接或访问权限",
            }),
            { status: 503 },
          );
        return page(sourceRecords[source] || []);
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <UserContext.Provider value={user}>
        <Resources />
      </UserContext.Provider>
    </QueryClientProvider>,
  );
  return { client, requests };
}

describe("source and local business resource catalogs", () => {
  it.each(["ADMIN", "DISPATCH"] as const)(
    "shows the authorized 4A personnel catalog by default for %s and retains local registration/editing",
    async (role) => {
      start(role);
      fireEvent.click(screen.getByRole("button", { name: "人员档案" }));
      await screen.findByText("来源人员档案");
      expect(
        screen.getByRole("columnheader", { name: "来源组织" }),
      ).toBeTruthy();
      expect(screen.getByText(/当前授权设备及关联组织范围/)).toBeTruthy();
      expect(screen.queryByText("本地登记人员")).toBeNull();
      expect(screen.queryByRole("button", { name: "登记资源" })).toBeNull();
      fireEvent.click(screen.getByText("来源人员档案"));
      const sourceDialog = screen.getByRole("dialog", { name: "来源人员档案" });
      expect(
        within(sourceDialog).queryByRole("button", { name: "编辑档案" }),
      ).toBeNull();
      fireEvent.click(
        within(sourceDialog).getByRole("button", { name: "关闭" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
      await screen.findByText("本地登记人员");
      expect(screen.getByText("1 条本地业务档案")).toBeTruthy();
      expect(screen.getByRole("button", { name: "登记资源" })).toBeTruthy();
      fireEvent.click(screen.getByText("本地登记人员"));
      const localDialog = screen.getByRole("dialog", { name: "本地登记人员" });
      expect(
        within(localDialog).getByRole("button", { name: "编辑档案" }),
      ).toBeTruthy();
    },
  );
  it.each([
    ["航线资源", "来源航线模板", "routes"],
    ["空域底数", "来源电子围栏", "airspaces"],
  ])(
    "keeps %s source data visible even when there are no local business archives",
    async (navigation, title, source) => {
      const { requests } = start();
      fireEvent.click(screen.getByRole("button", { name: navigation }));
      await screen.findByText(title);
      expect(
        requests.some(
          (url) => url.pathname === `/api/v1/source-data/${source}`,
        ),
      ).toBe(true);
      if (source === "airspaces") {
        expect(screen.getByText(/不代表监管空域审批结果/)).toBeTruthy();
        expect(
          screen.getByText("source-device-1,source-device-2"),
        ).toBeTruthy();
      }
      fireEvent.change(screen.getByPlaceholderText("搜索来源记录"), {
        target: { value: "目录关键词" },
      });
      await waitFor(() =>
        expect(
          requests.some(
            (url) => url.searchParams.get("keyword") === "目录关键词",
          ),
        ).toBe(true),
      );
      fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
      await screen.findByText("0 条本地业务档案");
      expect(screen.queryByText(title)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "来源目录" }));
      await screen.findByText(title);
    },
  );
  it("displays source connection failures rather than presenting a local zero as an empty source", async () => {
    start("ADMIN", "routes");
    fireEvent.click(screen.getByRole("button", { name: "航线资源" }));
    await screen.findByText("来源目录读取失败，请检查连接或访问权限");
    expect(screen.getByText("数据暂不可用")).toBeTruthy();
    expect(screen.queryByText("0 条本地业务档案")).toBeNull();
    expect(screen.queryByText("当前授权范围内暂无来源航线")).toBeNull();
  });
  it("keeps business-only roles on their accessible local archives without requesting restricted source catalogs", async () => {
    const { client, requests } = start("DEPARTMENT");
    fireEvent.click(screen.getByRole("button", { name: "人员档案" }));
    await screen.findByText("本地登记人员");
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByText("1 条本地业务档案")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "来源目录" })).toBeNull();
    expect(
      requests.some((url) => url.pathname.startsWith("/api/v1/source-data/")),
    ).toBe(false);
  });
});
