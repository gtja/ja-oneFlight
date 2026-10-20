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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity, Page } from "../api";
import CommandBoard from "./CommandBoard";

type BoardMapProps = {
  objects: Entity[];
  onSelect: (entity: Entity) => void;
  selectedObjectId?: string;
  focusRequest?: { entity: Entity; revision: number };
  layers: {
    airspace: boolean;
    sites: boolean;
    devices: boolean;
    detectors: boolean;
  };
};

const mocks = vi.hoisted(() => ({
  readCatalog: vi.fn<(path: string) => Promise<Page>>(),
  useDevices: vi.fn(),
  refetchDevices: vi.fn(),
  mapProps: vi.fn<(props: BoardMapProps) => void>(),
  windowEscape: vi.fn(),
}));

vi.mock("../api", () => ({
  readCatalog: mocks.readCatalog,
  useDevices: mocks.useDevices,
  entityName: (item: Entity) => item.title || item.name || item.id,
}));

// Map rendering is covered separately; retain the board's real selection contract.
vi.mock("../components/FlightMap", () => ({
  default: (props: BoardMapProps) => {
    mocks.mapProps(props);
    return (
      <div aria-label="飞行地图">
        {props.objects.map((item) => (
          <button
            key={item.id}
            aria-label={`地图选择 ${item.id}`}
            onClick={() => props.onSelect(item)}
          >
            地图对象
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("../components/CommandTaskCharts", () => ({
  HourlyChart: () => <div aria-label="任务时段图表" />,
  RegionalChart: () => <div aria-label="区域任务图表" />,
}));

const page = (items: Entity[]): Page => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});

const fleet: Entity[] = [
  {
    id: "uav-y",
    name: "余杭巡航一号机",
    type: "UAV",
    region: "上城区",
    status: "ONLINE",
    lastObservedAt: "2026-10-16T08:45:40Z",
    longitude: 120.1,
    latitude: 30.2,
    flightTotals: { sorties: 12, timeSeconds: 5400, distanceMeters: 12500 },
  },
  {
    id: "uav-s",
    name: "上城待机二号机",
    type: "UAV",
    region: "上城区",
    status: "OFFLINE",
    lastObservedAt: "2026-10-16T08:45:30Z",
    longitude: 120.2,
    latitude: 30.3,
    flightTotals: { sorties: 3, timeSeconds: 3600, distanceMeters: 3000 },
  },
  {
    id: "radar-y",
    name: "余杭过期雷达",
    type: "RADAR",
    region: "余杭区",
    status: "ONLINE",
    lastObservedAt: "2026-10-16T08:30:00Z",
  },
  {
    id: "dock-y",
    name: "余杭来源机巢",
    type: "DOCK",
    region: "余杭区",
    status: "ONLINE",
    lastObservedAt: "2026-10-16T08:45:50Z",
    longitude: 120.11,
    latitude: 30.21,
  },
];

const airspace: Entity = {
  id: "air-y",
  title: "余杭保护区",
  kind: "AIRSPACE",
  region: "余杭区",
  status: "ACTIVE",
  metadata: {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [120, 30],
          [120.5, 30],
          [120.5, 30.5],
          [120, 30.5],
          [120, 30],
        ],
      ],
    },
  },
};

const resources: Entity[] = [
  {
    id: "source-binding",
    title: "设备区域关联",
    kind: "DEVICE",
    sourceDeviceId: "uav-y",
    region: "余杭区",
  },
  {
    id: "site-y",
    title: "余杭应急起降点",
    kind: "LANDING_SITE",
    region: "余杭区",
    longitude: 120.12,
    latitude: 30.22,
    status: "ACTIVE",
  },
  {
    id: "site-s",
    title: "上城待建起降点",
    kind: "DOCK",
    region: "上城区",
    status: "PENDING",
  },
  airspace,
  {
    id: "route-s",
    title: "上城巡检航线",
    kind: "ROUTE",
    region: "上城区",
    geometry: {
      type: "LineString",
      coordinates: [
        [120.1, 30.1],
        [120.2, 30.2],
      ],
    },
  },
];

const tasks: Entity[] = [
  {
    id: "assign-y",
    title: "余杭待分配任务",
    region: "余杭区",
    status: "PENDING_ASSIGNMENT",
    startAt: "2026-10-16T00:00:00Z",
  },
  {
    id: "pending-s",
    title: "上城待执行任务",
    region: "上城区",
    status: "PENDING_EXECUTION",
    startAt: "2026-10-16T01:00:00Z",
  },
  {
    id: "executing-y",
    title: "余杭在飞任务",
    region: "余杭区",
    status: "EXECUTING",
    startAt: "2026-10-16T02:00:00Z",
  },
  {
    id: "completed-s",
    title: "上城已完成任务",
    region: "上城区",
    status: "COMPLETED",
    startAt: "2026-10-16T03:00:00Z",
  },
  {
    id: "cancelled-y",
    title: "余杭已取消任务",
    region: "余杭区",
    status: "CANCELLED",
    startAt: "2026-10-16T04:00:00Z",
  },
];

const plans: Entity[] = [
  {
    id: "plan-y",
    title: "余杭待审巡检计划",
    region: "余杭区",
    status: "PENDING_REVIEW",
  },
  {
    id: "plan-s",
    title: "上城获批计划",
    region: "上城区",
    status: "APPROVED",
  },
];

const cases: Entity[] = [
  {
    id: "case-y",
    title: "余杭待核线索",
    region: "余杭区",
    status: "OPEN",
    scene: "港口监测",
    description: "核对余杭港口异常飞行高度",
  },
  {
    id: "case-s",
    title: "上城归档线索",
    region: "上城区",
    status: "ARCHIVED",
    description: "上城核查已完成",
    conclusion: "已完成现场复核",
  },
  {
    id: "case-resolved-y",
    title: "余杭已处置线索",
    region: "余杭区",
    status: "RESOLVED",
    description: "余杭处置已完成",
  },
];

const catalogs: Record<string, Entity[]> = {
  "/resources": resources,
  "/tasks": tasks,
  "/cases": cases,
  "/plans": plans,
};
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T08:46:00Z"));
  vi.clearAllMocks();
  mocks.readCatalog.mockImplementation(async (path) => page(catalogs[path]));
  mocks.refetchDevices.mockResolvedValue({ isError: false });
  mocks.useDevices.mockReturnValue({
    data: page(fleet),
    dataUpdatedAt: Date.now(),
    isError: false,
    isPending: false,
    isFetching: false,
    refetch: mocks.refetchDevices,
  });
});

afterEach(() => {
  window.removeEventListener("keydown", mocks.windowEscape);
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

async function board() {
  const navigate = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <CommandBoard navigate={navigate} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /余杭保护区/ }, { timeout: 5000 });
  await waitFor(() => {
    expect(screen.getByTitle("查看待审计划明细").textContent).toBe("待审计划1");
    expect(screen.getByTitle("查看未结线索明细").textContent).toBe("未结线索2");
    expect(screen.getByTitle("查看当前执行任务").textContent).toContain("1");
  }, { timeout: 5000 });
  return navigate;
}

function latestMapProps() {
  return mocks.mapProps.mock.calls.at(-1)![0];
}

function openRecords(buttonTitle: string, groupTitle: string) {
  fireEvent.click(screen.getByTitle(buttonTitle));
  return screen.getByRole("dialog", { name: `${groupTitle}明细` });
}

function recordNames(dialog: HTMLElement, groupTitle: string) {
  return within(within(dialog).getByRole("list", { name: `${groupTitle}列表` }))
    .getAllByRole("button")
    .map((button) => button.querySelector("strong")?.textContent);
}

function closeDialog(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
}

function selectRegion(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "指挥区域" }));
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("指挥大屏卡片与地图交互", () => {
  it("资源卡片分别展示航空器、去重起降点与近期在线设备", async () => {
    const navigate = await board();
    for (const [title, names] of [
      ["航空器", ["余杭巡航一号机", "上城待机二号机"]],
      ["起降点", ["余杭来源机巢", "余杭应急起降点", "上城待建起降点"]],
      ["在线设备", ["余杭巡航一号机", "余杭来源机巢"]],
    ] as const) {
      const dialog = openRecords(`查看${title}明细`, title);
      expect(recordNames(dialog, title)).toEqual(names);
      closeDialog(dialog);
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it("从列表选择地图对象并可重复定位，Escape 关闭详情且不冒泡到窗口", async () => {
    const navigate = await board();
    const dialog = openRecords("查看航空器明细", "航空器");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /余杭巡航一号机/ }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const inspector = screen.getByRole("region", { name: "地图对象详情" });
    expect(within(inspector).getByRole("heading").textContent).toBe(
      "余杭巡航一号机",
    );
    expect(latestMapProps().selectedObjectId).toBe("uav-y");
    expect(latestMapProps().focusRequest?.entity.id).toBe("uav-y");
    const firstRevision = latestMapProps().focusRequest!.revision;
    fireEvent.click(within(inspector).getByRole("button", { name: "定位" }));
    const secondRevision = latestMapProps().focusRequest!.revision;
    fireEvent.click(within(inspector).getByRole("button", { name: "定位" }));
    expect(secondRevision).toBeGreaterThan(firstRevision);
    expect(latestMapProps().focusRequest!.revision).toBeGreaterThan(
      secondRevision,
    );
    window.addEventListener("keydown", mocks.windowEscape);
    fireEvent.keyDown(document, {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    expect(screen.queryByRole("region", { name: "地图对象详情" })).toBeNull();
    expect(latestMapProps().selectedObjectId).toBeUndefined();
    expect(latestMapProps().focusRequest).toBeUndefined();
    expect(mocks.windowEscape).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("无坐标资源仍能查看档案，定位禁用且 Escape 优先关闭档案弹窗", async () => {
    await board();
    const records = openRecords("查看起降点明细", "起降点");
    fireEvent.click(
      within(records).getByRole("button", { name: /上城待建起降点/ }),
    );
    const inspector = screen.getByRole("region", { name: "地图对象详情" });
    expect(
      (
        within(inspector).getByRole("button", {
          name: "定位",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      within(inspector).getByText("当前对象暂无有效位置，仍可查看档案"),
    ).toBeTruthy();
    expect(latestMapProps().selectedObjectId).toBe("site-s");
    expect(latestMapProps().focusRequest).toBeUndefined();
    fireEvent.click(
      within(inspector).getByRole("button", { name: /查看档案/ }),
    );
    const detail = screen.getByRole("dialog", { name: "上城待建起降点" });
    expect(within(detail).getByText("site-s")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "地图对象详情" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "地图对象详情" })).toBeNull();
  });

  it("空域卡片选中完整几何，关闭对应图层会清除选择，重选会打开图层", async () => {
    await board();
    fireEvent.click(screen.getByTitle("在地图查看余杭保护区"));
    const inspector = screen.getByRole("region", { name: "地图对象详情" });
    expect(
      (
        within(inspector).getByRole("button", {
          name: "定位",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(latestMapProps().focusRequest?.entity).toEqual(airspace);
    const layer = screen.getByRole("button", { name: "空域与航线" });
    fireEvent.click(layer);
    expect(layer.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("region", { name: "地图对象详情" })).toBeNull();
    expect(latestMapProps().selectedObjectId).toBeUndefined();
    expect(latestMapProps().focusRequest).toBeUndefined();
    fireEvent.click(screen.getByTitle("在地图查看余杭保护区"));
    expect(latestMapProps().layers.airspace).toBe(true);
    expect(latestMapProps().selectedObjectId).toBe("air-y");
  });

  it("地图点击受控选择，区域切换清除选择并同时约束卡片和零记录空态", async () => {
    await board();
    fireEvent.click(screen.getByRole("button", { name: "地图选择 uav-y" }));
    expect(latestMapProps().selectedObjectId).toBe("uav-y");
    selectRegion("上城区");
    expect(screen.queryByRole("region", { name: "地图对象详情" })).toBeNull();
    expect(latestMapProps().focusRequest).toBeUndefined();
    expect(latestMapProps().objects.map((item) => item.id)).toEqual([
      "uav-s",
      "site-s",
      "route-s",
    ]);
    const aircraft = openRecords("查看航空器明细", "航空器");
    expect(recordNames(aircraft, "航空器")).toEqual(["上城待机二号机"]);
    closeDialog(aircraft);
    const online = openRecords("查看在线设备明细", "在线设备");
    expect(within(online).getByRole("status").textContent).toContain(
      "当前范围暂无记录",
    );
    closeDialog(online);
    selectRegion("西湖区");
    expect(screen.getByTitle("查看航空器明细").textContent).toBe("航空器0架");
    expect(screen.getByTitle("查看起降点明细").textContent).toBe("起降点0处");
    const empty = openRecords("查看待执行/分配明细", "待执行/分配任务");
    expect(within(empty).getByRole("status").textContent).toContain(
      "当前范围暂无记录",
    );
    expect(within(empty).getByText("西湖区 · 当前授权范围")).toBeTruthy();
  });

  it("健康卡片按线索状态过滤，记录点击展示对应描述和结论", async () => {
    const navigate = await board();
    const open = openRecords("查看未结线索明细", "未结线索");
    expect(recordNames(open, "未结线索")).toEqual([
      "余杭待核线索",
      "余杭已处置线索",
    ]);
    fireEvent.click(within(open).getByRole("button", { name: /余杭待核线索/ }));
    const detail = screen.getByRole("dialog", { name: "余杭待核线索" });
    expect(within(detail).getByText("核对余杭港口异常飞行高度")).toBeTruthy();
    expect(within(detail).queryByText("上城核查已完成")).toBeNull();
    closeDialog(detail);
    const reviewed = openRecords("查看已归档/处置线索", "已归档/处置线索");
    expect(recordNames(reviewed, "已归档/处置线索")).toEqual([
      "上城归档线索",
      "余杭已处置线索",
    ]);
    fireEvent.click(
      within(reviewed).getByRole("button", { name: /上城归档线索/ }),
    );
    const archived = screen.getByRole("dialog", { name: "上城归档线索" });
    expect(within(archived).getByText("已完成现场复核")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("待审计划卡片只含待审申请，选择记录携带 planId 进入服务", async () => {
    const navigate = await board();
    const dialog = openRecords("查看待审计划明细", "待审计划");
    expect(recordNames(dialog, "待审计划")).toEqual(["余杭待审巡检计划"]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: /余杭待审巡检计划/ }),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("services", {
      planId: "plan-y",
    });
  });

  it("计划与任务卡片保留各状态边界，当前执行入口直达对应任务列表", async () => {
    const navigate = await board();
    for (const [buttonTitle, groupTitle, names] of [
      [
        "查看待执行/分配明细",
        "待执行/分配任务",
        ["余杭待分配任务", "上城待执行任务"],
      ],
      ["查看执行中明细", "执行中任务", ["余杭在飞任务"]],
      ["查看已完成明细", "已完成任务", ["上城已完成任务"]],
      ["查看飞行计划明细", "飞行计划", ["余杭待审巡检计划", "上城获批计划"]],
    ] as const) {
      const dialog = openRecords(buttonTitle, groupTitle);
      expect(recordNames(dialog, groupTitle)).toEqual(names);
      closeDialog(dialog);
    }
    const current = openRecords("查看当前执行任务", "执行中任务");
    expect(recordNames(current, "执行中任务")).toEqual(["余杭在飞任务"]);
    fireEvent.click(
      within(current).getByRole("button", { name: /余杭在飞任务/ }),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("dispatch", {
      taskId: "executing-y",
    });
  });

  it("累计指标仅列上报统计的设备，时长和里程按小时与公里换算", async () => {
    await board();
    for (const [title, firstMetric, secondMetric] of [
      ["累计飞行架次", "12 架次", "3 架次"],
      ["累计飞行时长", "1.5 小时", "1 小时"],
      ["累计飞行里程", "12.5 公里", "3 公里"],
    ]) {
      const dialog = openRecords(`查看${title}的设备贡献明细`, title);
      expect(recordNames(dialog, title)).toEqual([
        "余杭巡航一号机",
        "上城待机二号机",
      ]);
      expect(within(dialog).getByText(firstMetric)).toBeTruthy();
      expect(within(dialog).getByText(secondMetric)).toBeTruthy();
      closeDialog(dialog);
    }
  });

  it("数据保障可查看五个来源的同步状态，立即刷新会重取全部来源", async () => {
    await board();
    expect(mocks.readCatalog).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByTitle("查看设备与遥测同步状态"));
    const dialog = screen.getByRole("dialog", { name: "数据同步状态" });
    for (const label of [
      "来源设备",
      "资源与空域",
      "任务目录",
      "线索目录",
      "飞行计划",
    ]) {
      expect(within(dialog).getByText(label)).toBeTruthy();
    }
    expect(within(dialog).getAllByText("已同步")).toHaveLength(5);
    fireEvent.click(within(dialog).getByRole("button", { name: "立即刷新" }));
    await waitFor(() => {
      expect(mocks.refetchDevices).toHaveBeenCalledTimes(1);
      expect(mocks.readCatalog).toHaveBeenCalledTimes(8);
      expect(screen.getByText("当前授权范围的数据已刷新")).toBeTruthy();
    });
    for (const path of Object.keys(catalogs)) {
      expect(
        mocks.readCatalog.mock.calls.filter(([value]) => value === path),
      ).toHaveLength(2);
    }
  });
});
