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
import type { CurrentUser, Entity, Page } from "../api";
import { UserContext } from "../context";
import Resources from "./Resources";

vi.mock("../components/GeometryInput", () => ({ default: () => null }));

const device: Entity = {
  id: "9223372036854775807",
  name: "来源机巢",
  type: "DOCK",
  status: "ONLINE",
  flightTotals: { sorties: 12, timeSeconds: 3600, distanceMeters: 3000 },
};
const binding: Entity = {
  id: "local-device-archive",
  title: "机巢调度档案",
  kind: "DEVICE",
  sourceDeviceId: device.id,
  status: "ACTIVE",
  flightTotals: { sorties: 999 },
};
const localObjects: Entity[] = [
  binding,
  {
    id: "local-unbound-device",
    title: "未关联设备档案",
    kind: "DEVICE",
    productKey: "local-product",
    status: "ACTIVE",
  },
  {
    id: "local-route",
    title: "本地航线",
    kind: "ROUTE",
    productKey: "route-product",
    status: "ACTIVE",
  },
  {
    id: "local-airspace",
    title: "本地空域",
    kind: "AIRSPACE",
    productKey: "airspace-product",
    status: "ACTIVE",
  },
];
const user: CurrentUser = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  role: "ADMIN",
  organizationId: "org-1",
  regions: [],
  deviceIds: [],
};
const page = (items: Entity[]): Page => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});
const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      code: status === 200 ? "SUCCESS" : "SOURCE_UNAVAILABLE",
      message: status === 200 ? "成功" : "来源暂不可用",
      data,
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function renderResources(
  options: {
    sources?: Entity[];
    devicesResponse?: () => Response | Promise<Response>;
    detailReady?: Promise<void>;
    cachedSourceTable?: boolean;
  } = {},
) {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    switch (url.pathname) {
      case "/api/v1/devices":
        return options.devicesResponse
          ? options.devicesResponse()
          : response(page(options.sources || [device]));
      case "/api/v1/resources":
        return response(
          page(
            localObjects.filter(
              (item) => item.kind === url.searchParams.get("kind"),
            ),
          ),
        );
      case "/api/v1/organizations":
        return response(page([]));
      case "/api/v1/source-data/people":
      case "/api/v1/source-data/routes":
      case "/api/v1/source-data/airspaces":
        return response(page([]));
      case `/api/v1/devices/${device.id}`:
        await options.detailReady;
        return response(device);
      case "/api/v1/flights":
        if (url.searchParams.get("deviceId") === device.id)
          return response(page([{ id: "flight-1", sortieNo: "真实架次" }]));
        break;
      case "/api/v1/executions":
        if (url.searchParams.get("deviceId") === device.id)
          return response(page([{ id: "execution-1", name: "真实作业" }]));
    }
    return response(null, 403);
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (options.cachedSourceTable)
    client.setQueryData(["/devices", "page=1&pageSize=100"], page([device]));
  clients.push(client);
  const navigate = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <UserContext.Provider value={user}>
        <Resources navigate={navigate} />
      </UserContext.Provider>
    </QueryClientProvider>,
  );
  return { client, requests, navigate };
}

function deviceRequests(requests: URL[]) {
  return requests.filter(
    (url) =>
      url.pathname.startsWith("/api/v1/devices/") ||
      ["/api/v1/flights", "/api/v1/executions"].includes(url.pathname),
  );
}

async function openArchive(item = binding) {
  if (item.kind === "DEVICE")
    fireEvent.click(screen.getByRole("button", { name: "调度档案" }));
  else {
    fireEvent.click(
      screen.getByRole("button", {
        name: item.kind === "ROUTE" ? "航线资源" : "空域底数",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
  }
  fireEvent.click(
    await screen.findByText(String(item.title), { selector: "strong" }),
  );
  return screen.getByRole("dialog", { name: String(item.title) });
}

describe("资源详情的来源设备身份", () => {
  it.each([
    { sources: [device], schedulable: 1 },
    { sources: [], schedulable: 0 },
  ])(
    "调度状态统计只计算当前已接入来源目录的档案 $schedulable",
    async ({ sources, schedulable }) => {
      const { client } = renderResources({ sources });
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(
        screen
          .getByLabelText("设备接入与调度说明")
          .textContent?.replace(/\s/g, ""),
      ).toContain(`已接入${sources.length}台·可调度${schedulable}台·待确认0台`);
    },
  );
  it("从设备档案进入任务筛选，不直接启动来源飞控", async () => {
    const { navigate, requests } = renderResources();
    const dialog = await openArchive();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "选择关联任务并检查飞控入口",
      }),
    );
    expect(navigate).toHaveBeenCalledWith("flight", { deviceId: device.id });
    expect(
      requests.some((url) => url.pathname.includes("/flight-control/launch")),
    ).toBe(false);
  });
  it("关联设备已不在来源目录时保留本地档案并说明当前不可见", async () => {
    const { client, requests } = renderResources({ sources: [] });
    const dialog = await openArchive();
    expect(
      await within(dialog).findByText(/关联的来源设备当前不可见/),
    ).toBeTruthy();
    expect(within(dialog).getByText(binding.id)).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "编辑档案" }),
    ).toBeTruthy();
    expect(within(dialog).queryByText("设备飞行架次记录")).toBeNull();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(deviceRequests(requests)).toEqual([]);
  });

  it("来源目录读取失败时说明原因且不尝试已无法核实的设备接口", async () => {
    const { client, requests } = renderResources({
      devicesResponse: () => response(null, 503),
    });
    const dialog = await openArchive();
    expect(
      await within(dialog).findByText(/来源设备目录读取失败：来源暂不可用/),
    ).toBeTruthy();
    expect(within(dialog).getByText(binding.id)).toBeTruthy();
    expect(within(dialog).queryByText(/关联的来源设备当前不可见/)).toBeNull();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(deviceRequests(requests)).toEqual([]);
  });

  it("来源目录加载期间等待核对，成功后才读取关联来源记录", async () => {
    let resolveDirectory!: () => void;
    const directoryReady = new Promise<void>((resolve) => {
      resolveDirectory = resolve;
    });
    const { client, requests } = renderResources({
      devicesResponse: async () => {
        await directoryReady;
        return response(page([device]));
      },
    });
    const dialog = await openArchive();
    expect(
      within(dialog).getByText("正在核对关联来源设备，完成后展示飞行记录。"),
    ).toBeTruthy();
    expect(within(dialog).getByText(binding.id)).toBeTruthy();
    expect(deviceRequests(requests)).toEqual([]);
    resolveDirectory();
    expect(await within(dialog).findByText("真实架次")).toBeTruthy();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(deviceRequests(requests)).toHaveLength(2);
  });

  it("本地绑定使用来源设备编号与统计，不把本地对象伪装成来源设备", async () => {
    let resolveDetail!: () => void;
    const detailReady = new Promise<void>((resolve) => {
      resolveDetail = resolve;
    });
    const { client, requests } = renderResources({ detailReady });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const dialog = await openArchive();
    expect(within(dialog).getByText("12 架次")).toBeTruthy();
    expect(within(dialog).queryByText("999 架次")).toBeNull();
    resolveDetail();
    expect(await within(dialog).findByText("真实架次")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("tab", { name: "任务执行记录" }));
    expect(await within(dialog).findByText("真实作业")).toBeTruthy();
    expect(deviceRequests(requests)).toHaveLength(3);
    expect(
      deviceRequests(requests).every(
        (url) =>
          url.pathname === `/api/v1/devices/${device.id}` ||
          url.searchParams.get("deviceId") === device.id,
      ),
    ).toBe(true);
  });

  it("来源表行在全量目录失败时仍可按来源设备编号查看记录", async () => {
    const { requests } = renderResources({
      cachedSourceTable: true,
      devicesResponse: () => response(null, 503),
    });
    fireEvent.click(
      await screen.findByText(String(device.name), { selector: "strong" }),
    );
    const dialog = screen.getByRole("dialog", { name: String(device.name) });
    expect(await within(dialog).findByText("真实架次")).toBeTruthy();
    expect(within(dialog).queryByText(/来源设备目录读取失败/)).toBeNull();
    expect(
      deviceRequests(requests).every(
        (url) =>
          url.pathname === `/api/v1/devices/${device.id}` ||
          url.searchParams.get("deviceId") === device.id,
      ),
    ).toBe(true);
  });

  it.each(localObjects.slice(1))(
    "带 productKey 的 $title 不触发来源设备请求",
    async (item) => {
      const { client, requests } = renderResources();
      const dialog = await openArchive(item);
      expect(within(dialog).getByText(item.id)).toBeTruthy();
      expect(within(dialog).queryByText("设备飞行架次记录")).toBeNull();
      expect(within(dialog).queryByText(/关联的来源设备当前不可见/)).toBeNull();
      expect(
        within(dialog).queryByRole("button", { name: "登记调度资料" }),
      ).toBeNull();
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(deviceRequests(requests)).toEqual([]);
    },
  );

  it("空域清单保留缺少有效边界的记录并明确提示", async () => {
    const { client } = renderResources();
    fireEvent.click(screen.getByRole("button", { name: "空域底数" }));
    fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByLabelText("空域资源地图")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "1 条记录缺少有效边界，已保留在清单中。",
    );
    expect(screen.getByRole("button", { name: /本地空域/ })).toBeTruthy();
  });
});
