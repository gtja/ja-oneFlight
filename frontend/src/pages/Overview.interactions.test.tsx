// @vitest-environment jsdom
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
import type { Entity, Page } from "../api";
import Overview from "./Overview";

const mapObjects = vi.hoisted(() => vi.fn<(objects: Entity[]) => void>());

// Keep real queries and detail panels; map rendering is covered separately.
vi.mock("../components/FlightMap", () => ({
  default: ({
    objects,
    onSelect,
  }: {
    objects: Entity[];
    onSelect: (entity: Entity) => void;
  }) => {
    mapObjects(objects);
    return (
      <div aria-label="飞行地图">
        {objects.map((item) => (
          <button
            key={item.id}
            aria-label={`地图选择 ${item.id}`}
            onClick={() => onSelect(item)}
          >
            {item.name || item.title}
          </button>
        ))}
      </div>
    );
  },
}));

const sourceDevices: Entity[] = [
  {
    id: "9223372036854775807",
    name: "余杭来源航空器",
    type: "UAV",
    status: "ONLINE",
    flightTotals: { sorties: 12, timeSeconds: 5400, distanceMeters: 12500 },
  },
  {
    id: "source-dock",
    name: "上城来源机巢",
    type: "DOCK",
    productKey: "dock-product",
    status: "ONLINE",
    flightTotals: { sorties: 3, timeSeconds: 3600, distanceMeters: 3000 },
  },
];

const localObjects: Entity[] = [
  {
    id: "2a880b21-51a8-3e3f-9c81-dbe08dda3f53",
    title: "shiyang-way",
    kind: "ROUTE",
    productKey: "route-product",
    region: "余杭区",
    status: "ACTIVE",
  },
  {
    id: "local-airspace",
    title: "余杭保护空域",
    kind: "AIRSPACE",
    productKey: "airspace-product",
    region: "余杭区",
    status: "ACTIVE",
  },
  {
    id: "local-device",
    title: "未关联来源的本地设备",
    kind: "DEVICE",
    productKey: "local-product",
    region: "余杭区",
    status: "ACTIVE",
  },
];

const resources: Entity[] = [
  ...localObjects,
  {
    id: "local-uav-binding",
    title: "航空器区域档案",
    kind: "DEVICE",
    sourceDeviceId: sourceDevices[0].id,
    region: "余杭区",
  },
  {
    id: "local-dock-binding",
    title: "机巢区域档案",
    kind: "DEVICE",
    sourceDeviceId: sourceDevices[1].id,
    region: "上城区",
  },
];

const page = (items: Entity[]): Page => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});

const response = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      code: status === 200 ? "SUCCESS" : "FORBIDDEN",
      message: status === 200 ? "成功" : "没有访问权限",
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
  vi.useRealTimers();
  mapObjects.mockClear();
});

function renderOverview({
  tasks = [],
  resourceItems = () => resources,
}: {
  tasks?: Entity[];
  resourceItems?: () => Entity[];
} = {}) {
  const requests: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    requests.push(url);
    switch (url.pathname) {
      case "/api/v1/dashboard":
        return response({ executingTasks: 0, openCases: 0, resourcesCount: 5 });
      case "/api/v1/devices":
        return response(page(sourceDevices));
      case "/api/v1/weather/observations":
        return response({
          sourceHealth: { name: "机巢遥测", state: "HEALTHY" },
          stations: [],
        });
      case "/api/v1/resources":
        return response(page(resourceItems()));
      case "/api/v1/cases":
        return response(page([]));
      case "/api/v1/tasks":
        return response(page(tasks));
    }
    const selectedDevice = sourceDevices.find(
      (device) =>
        url.pathname === `/api/v1/devices/${device.id}` ||
        url.searchParams.get("deviceId") === device.id,
    );
    if (!selectedDevice) return response(null, 403);
    if (url.pathname === `/api/v1/devices/${selectedDevice.id}`)
      return response(selectedDevice);
    if (url.pathname === "/api/v1/flights")
      return response(
        page([
          {
            id: `flight-${selectedDevice.id}`,
            sortieNo: `真实架次-${selectedDevice.id}`,
            flightTimeSeconds: 600,
          },
        ]),
      );
    if (url.pathname === "/api/v1/executions")
      return response(
        page([
          {
            id: `execution-${selectedDevice.id}`,
            name: `真实作业-${selectedDevice.id}`,
            status: "COMPLETED",
          },
        ]),
      );
    return response(null, 403);
  });
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const navigate = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <Overview navigate={navigate} />
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

describe("态势感知对象详情的来源边界", () => {
  it("没有机巢气象观测时，切换地图图层会说明当前原因", async () => {
    renderOverview();
    expect(await screen.findByText("暂无机巢上报风速、温度或湿度")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "机巢气象" }));
    expect(
      screen.getByRole("status").textContent,
    ).toContain("当前没有机巢上报风速、温度或湿度");
  });

  it("资源目录失效后同步空域几何和已打开的详情，删除后不保留旧档案", async () => {
    const original: Entity = {
      ...localObjects[1],
      metadata: {
        geometry: {
          type: "Polygon",
          coordinates: [
            [[120, 30], [120.01, 30], [120.01, 30.01], [120, 30]],
          ],
        },
      },
    };
    let current = [original];
    const { client } = renderOverview({ resourceItems: () => current });
    fireEvent.click(
      await screen.findByRole("button", { name: `地图选择 ${original.id}` }),
    );
    expect(
      screen.getByRole("dialog", { name: String(original.title) }),
    ).toBeTruthy();
    const updated: Entity = {
      ...original,
      title: "更新后的保护空域",
      status: "PENDING_CONFIRMATION",
      metadata: {
        geometry: {
          type: "Polygon",
          coordinates: [
            [[120.1, 30.1], [120.2, 30.1], [120.2, 30.2], [120.1, 30.1]],
          ],
        },
      },
    };
    current = [updated];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["catalog", "/resources"] });
    });
    await waitFor(() =>
      expect(
        mapObjects.mock.calls.at(-1)?.[0].find((item) => item.id === updated.id),
      ).toEqual(updated),
    );
    const dialog = screen.getByRole("dialog", { name: String(updated.title) });
    expect(within(dialog).getByText("待确认")).toBeTruthy();

    current = [];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["catalog", "/resources"] });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.queryByRole("button", { name: `地图选择 ${original.id}` }),
    ).toBeNull();
  });

  it("每30秒刷新空域目录，继续按当前区域过滤新增及变更档案", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let current = [localObjects[1]];
    const { client, requests } = renderOverview({ resourceItems: () => current });
    await screen.findByRole("button", { name: `地图选择 ${localObjects[1].id}` });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    fireEvent.click(screen.getByRole("combobox", { name: "指挥区域" }));
    fireEvent.click(screen.getByRole("option", { name: "余杭区" }));
    fireEvent.click(
      screen.getByRole("button", { name: `地图选择 ${localObjects[1].id}` }),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    current = [
      { ...localObjects[1], title: "其他区域空域", region: "上城区" },
      { ...localObjects[1], id: "new-airspace", title: "新登记空域" },
    ];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await screen.findByRole("button", { name: "地图选择 new-airspace" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: `地图选择 ${localObjects[1].id}` }),
    ).toBeNull();
    expect(
      requests.filter((url) => url.pathname === "/api/v1/resources"),
    ).toHaveLength(2);
  });

  it("执行任务入口传递任务编号，由管控页解析对应来源设备", async () => {
    const task: Entity = {
      id: "task-river-patrol",
      title: "河道巡查任务",
      status: "EXECUTING",
      deviceId: "local-device",
    };
    const { navigate } = renderOverview({ tasks: [task] });
    fireEvent.click(
      await screen.findByRole("button", { name: /河道巡查任务/ }),
    );
    expect(navigate).toHaveBeenCalledWith("flight", { taskId: task.id });
  });

  it.each([
    { item: localObjects[0], label: "航线" },
    { item: localObjects[1], label: "空域" },
    { item: localObjects[2], label: "设备档案" },
  ])(
    "选择带 productKey 的 $label 只显示本地资源详情",
    async ({ item, label }) => {
      const { client, requests } = renderOverview();
      fireEvent.click(
        await screen.findByRole("button", { name: `地图选择 ${item.id}` }),
      );
      const dialog = screen.getByRole("dialog", { name: String(item.title) });
      expect(within(dialog).getByText("资源类型")).toBeTruthy();
      expect(within(dialog).getByText(label)).toBeTruthy();
      expect(within(dialog).getByText(`${label}编号`)).toBeTruthy();
      expect(within(dialog).getByText(item.id)).toBeTruthy();
      expect(within(dialog).queryByText("累计飞行统计")).toBeNull();
      expect(within(dialog).queryByText("设备飞行架次记录")).toBeNull();
      expect(
        within(dialog).queryByRole("button", { name: "查看设备遥测" }),
      ).toBeNull();
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(deviceRequests(requests)).toEqual([]);
      expect(within(dialog).queryByText(/没有访问权限/)).toBeNull();
    },
  );

  it.each(sourceDevices)(
    "来源设备 $name 使用真实编号查询架次和执行记录",
    async (device) => {
      const { requests, navigate } = renderOverview();
      fireEvent.click(
        await screen.findByRole("button", { name: `地图选择 ${device.id}` }),
      );
      const dialog = screen.getByRole("dialog", { name: String(device.name) });
      expect(within(dialog).getByText("设备编号")).toBeTruthy();
      expect(within(dialog).getByText(device.id)).toBeTruthy();
      expect(within(dialog).getByText("累计飞行统计")).toBeTruthy();
      expect(
        await within(dialog).findByText(`真实架次-${device.id}`),
      ).toBeTruthy();
      expect(
        requests.some((url) => url.pathname === `/api/v1/devices/${device.id}`),
      ).toBe(true);
      expect(
        requests.some(
          (url) =>
            url.pathname === "/api/v1/flights" &&
            url.searchParams.get("deviceId") === device.id,
        ),
      ).toBe(true);
      fireEvent.click(
        within(dialog).getByRole("tab", { name: "任务执行记录" }),
      );
      expect(
        await within(dialog).findByText(`真实作业-${device.id}`),
      ).toBeTruthy();
      expect(
        requests.some(
          (url) =>
            url.pathname === "/api/v1/executions" &&
            url.searchParams.get("deviceId") === device.id,
        ),
      ).toBe(true);
      expect(
        deviceRequests(requests).every(
          (url) =>
            url.pathname === `/api/v1/devices/${device.id}` ||
            url.searchParams.get("deviceId") === device.id,
        ),
      ).toBe(true);
      fireEvent.click(
        within(dialog).getByRole("button", { name: "查看设备遥测" }),
      );
      expect(navigate).toHaveBeenCalledWith("flight", { deviceId: device.id });
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("区域设备数和飞行累计值排除本地航线、空域及未关联设备", async () => {
    const { client } = renderOverview();
    await screen.findByRole("button", {
      name: `地图选择 ${localObjects[0].id}`,
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const deviceMetric = screen.getByRole("button", { name: /来源设备/ });
    expect(within(deviceMetric).getByText("2")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "指挥区域" }));
    fireEvent.click(screen.getByRole("option", { name: "余杭区" }));
    expect(within(deviceMetric).getByText("1")).toBeTruthy();
    expect(
      within(screen.getByRole("button", { name: /累计飞行架次/ })).getByText(
        "12",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: `地图选择 ${sourceDevices[1].id}` }),
    ).toBeNull();
    for (const item of localObjects)
      expect(
        screen.getByRole("button", { name: `地图选择 ${item.id}` }),
      ).toBeTruthy();
  });
});
