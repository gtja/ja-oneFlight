// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Entity } from "../api";
import { UserContext } from "../context";
import Resources from "./Resources";

vi.mock("../components/GeometryInput", () => ({
  default: () => null,
  AirspaceProfileInput: () => null,
}));
vi.mock("../components/FlightMap", () => ({ default: () => null }));
const clients: QueryClient[] = [];
const user: CurrentUser = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  role: "ADMIN",
  organizationId: "org-100",
  regions: [],
  deviceIds: [],
};
const envelope = (items: Entity[], total = items.length, page = 1) =>
  new Response(
    JSON.stringify({
      code: "SUCCESS",
      data: { items, total, page, pageSize: 100 },
    }),
  );
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}
async function start(
  options: {
    organizationGate?: Promise<void>;
    organizationFails?: () => boolean;
  } = {},
) {
  const requests: URL[] = [];
  const navigate = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(input, "http://localhost");
      requests.push(url);
      if (url.pathname === "/api/v1/organizations") {
        await options.organizationGate;
        if (options.organizationFails?.())
          return new Response(
            JSON.stringify({
              code: "SOURCE_UNAVAILABLE",
              message: "合成组织目录失败",
            }),
            { status: 503 },
          );
        const page = Number(url.searchParams.get("page"));
        return envelope(
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                id: `org-${index}`,
                title: `组织${index}`,
              }))
            : [{ id: "org-100", title: "第101个组织" }],
          101,
          page,
        );
      }
      if (url.pathname === "/api/v1/devices")
        return envelope([
          { id: "device-1", name: "合成设备", type: "UAV", status: "ONLINE" },
        ]);
      if (url.pathname === "/api/v1/attachments")
        return envelope([
          { id: "photo-id", title: "photo.png", fileName: "photo.png", contentType: "image/png" },
          { id: "document-id", title: "report.pdf", fileName: "report.pdf", contentType: "application/pdf" },
        ]);
      if (url.pathname === "/api/v1/flights")
        return envelope([
          { id: "flight-id", title: "真实架次", deviceId: "source-device-1", sortieNo: "真实架次" },
        ]);
      if (url.pathname === "/api/v1/weather/observations")
        return new Response(
          JSON.stringify({
            code: "SUCCESS",
            data: {
              sourceHealth: { name: "实时遥测", state: "HEALTHY" },
              stations: [
                {
                  deviceId: "dock-1",
                  deviceName: "测试机巢",
                  status: "ONLINE",
                  observedAt: "2026-10-26T05:00:00Z",
                  windSpeed: 3.2,
                  temperature: 24,
                  humidity: 60,
                },
              ],
            },
          }),
        );
      if (url.pathname.startsWith("/api/v1/source-data/")) {
        const kind = url.pathname.split("/").at(-1)!;
        return envelope([{ id: `${kind}-1`, title: `${kind}来源记录` }]);
      }
      if (url.pathname === "/api/v1/resources") return envelope([]);
      throw new Error(`Unexpected request ${url.pathname}`);
    }),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 10_000 },
    },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <UserContext.Provider value={user}>
        <Resources navigate={navigate} />
      </UserContext.Provider>
    </QueryClientProvider>,
  );
  await flush();
  expect(client.isFetching()).toBe(0);
  return { requests, client, navigate };
}
function requestsFor(requests: URL[], pathname: string) {
  return requests.filter((url) => url.pathname === pathname);
}

describe("资源目录按需请求", () => {
  it("打开气象资源时读取机巢实时观测并显示遥测来源状态", async () => {
    const { requests } = await start();
    fireEvent.click(screen.getByRole("button", { name: "气象资源" }));
    await flush();
    expect(screen.getByRole("main", { name: "气象资源" })).toBeTruthy();
    expect(screen.getByText("机库遥测已连接")).toBeTruthy();
    expect(screen.getByText("测试机巢")).toBeTruthy();
    expect(screen.getByText("3.2 米/秒")).toBeTruthy();
    expect(
      requestsFor(requests, "/api/v1/weather/observations").length,
    ).toBeGreaterThan(0);
  });

  it("成果照片可预览、其他文件仍可下载，并带设备筛选进入飞控任务放行流程", async () => {
    const { navigate } = await start();
    fireEvent.click(screen.getByRole("button", { name: "数据成果" }));
    await flush();
    expect(screen.getByText("photo.png")).toBeTruthy();
    fireEvent.click(screen.getByText("photo.png"));
    const photoDialog = screen.getByRole("dialog", { name: "photo.png" });
    expect(within(photoDialog).getByRole("img", { name: "photo.png" }).getAttribute("src"))
      .toBe("/api/v1/attachments/photo-id/preview");
    expect(within(photoDialog).getByRole("link", { name: "下载文件" }).getAttribute("href"))
      .toBe("/api/v1/attachments/photo-id/download");
    fireEvent.click(within(photoDialog).getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByText("report.pdf"));
    await flush();
    const documentDialog = screen.getByRole("dialog", { name: "report.pdf" });
    expect(within(documentDialog).queryByRole("img")).toBeNull();
    expect(within(documentDialog).getByText("该文件类型不支持在线预览，可下载查看。"))
      .toBeTruthy();
    expect(within(documentDialog).getByRole("link", { name: "下载文件" }).getAttribute("href"))
      .toBe("/api/v1/attachments/document-id/download");
    fireEvent.click(within(documentDialog).getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: "飞行记录" }));
    await flush();
    expect(screen.getByText("真实架次")).toBeTruthy();
    fireEvent.click(screen.getByText("真实架次"));
    const flightDialog = screen.getByRole("dialog", { name: /真实架次/ });
    fireEvent.click(
      within(flightDialog).getByRole("button", { name: /进入牍术飞控/ }),
    );
    expect(navigate).toHaveBeenCalledWith("flight", { deviceId: "source-device-1" });
  });

  it("浏览人员和航线来源时不读取组织，也不继续设备轮询", async () => {
    const { requests } = await start();
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(0);
    const beforeDevices = requestsFor(requests, "/api/v1/devices").length;
    fireEvent.click(screen.getByRole("button", { name: "人员档案" }));
    await flush();
    expect(screen.getByText("people来源记录")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "航线资源" }));
    await flush();
    expect(screen.getByText("routes来源记录")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(requestsFor(requests, "/api/v1/devices")).toHaveLength(
      beforeDevices,
    );
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(0);
    expect(requestsFor(requests, "/api/v1/source-data/people")).toHaveLength(1);
    expect(requestsFor(requests, "/api/v1/source-data/routes")).toHaveLength(1);
  });

  it.each(["人员档案", "航线资源"])(
    "打开%s登记表时才加载完整组织目录，不恢复设备轮询",
    async (navigation) => {
      let releaseOrganizations!: () => void;
      const organizationGate = new Promise<void>((resolve) => {
        releaseOrganizations = resolve;
      });
      const { requests } = await start({ organizationGate });
      fireEvent.click(screen.getByRole("button", { name: navigation }));
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
      await flush();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(11_000);
      });
      const beforeDevices = requestsFor(requests, "/api/v1/devices").length;
      fireEvent.click(screen.getByRole("button", { name: "登记资源" }));
      await flush();
      expect(screen.getByText("正在读取业务组织…")).toBeTruthy();
      expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(requestsFor(requests, "/api/v1/devices")).toHaveLength(
        beforeDevices,
      );
      releaseOrganizations();
      await flush();
      expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(2);
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByRole("combobox", { name: /业务所属组织/ })
          .textContent,
      ).toContain("第101个组织");
      fireEvent.click(
        within(dialog).getByRole("combobox", { name: /业务所属组织/ }),
      );
      expect(screen.getByRole("option", { name: "第101个组织" })).toBeTruthy();
    },
  );

  it("批量导入打开后仍加载完整组织选择，不预先请求", async () => {
    const { requests } = await start();
    fireEvent.click(screen.getByRole("button", { name: "空域底数" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
    await flush();
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "批量导入" }));
    await flush();
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(2);
    expect(
      screen.getByRole("combobox", { name: "业务所属组织" }).textContent,
    ).toContain("第101个组织");
  });

  it("维护登记仍能读取设备选择和完整组织目录", async () => {
    const { requests } = await start();
    fireEvent.click(screen.getByRole("button", { name: "人员档案" }));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    const beforeDevices = requestsFor(requests, "/api/v1/devices").length;
    fireEvent.click(screen.getByRole("button", { name: "设备维护" }));
    await flush();
    expect(requestsFor(requests, "/api/v1/devices").length).toBeGreaterThan(
      beforeDevices,
    );
    fireEvent.click(screen.getByRole("button", { name: "登记资源" }));
    await flush();
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(2);
    fireEvent.click(screen.getByRole("combobox", { name: /维护设备/ }));
    expect(screen.getByRole("option", { name: "合成设备" })).toBeTruthy();
  });

  it("来源航线仅导航到同名搜索的本地档案，不写入或自动认领", async () => {
    const { requests } = await start();
    fireEvent.click(screen.getByRole("button", { name: "航线资源" }));
    await flush();
    fireEvent.click(screen.getByText("routes来源记录"));
    fireEvent.click(screen.getByRole("button", { name: "查看本地航线档案" }));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (
        screen.getByPlaceholderText(
          "搜索资源名称、编号或型号",
        ) as HTMLInputElement
      ).value,
    ).toBe("routes来源记录");
    expect(
      requests.some(
        (url) =>
          url.pathname === "/api/v1/resources" &&
          url.searchParams.get("kind") === "ROUTE" &&
          url.searchParams.get("keyword") === "routes来源记录",
      ),
    ).toBe(true);
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(0);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([, options]) => !options?.method || options.method === "GET",
        ),
    ).toBe(true);
  });

  it("组织失败时明确错误，重试后仍可使用表单", async () => {
    let organizationFails = true;
    const { requests } = await start({
      organizationFails: () => organizationFails,
    });
    fireEvent.click(screen.getByRole("button", { name: "人员档案" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "登记资源" }));
    await flush();
    expect(screen.getByRole("alert").textContent).toContain("合成组织目录失败");
    expect(requestsFor(requests, "/api/v1/organizations")).toHaveLength(1);
    organizationFails = false;
    fireEvent.click(screen.getByRole("button", { name: "重试组织目录" }));
    await flush();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("combobox", { name: /业务所属组织/ }).textContent,
    ).toContain("第101个组织");
  });
});
