// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Entity, Page } from "../api";
import CommandBoard from "./CommandBoard";

const mocks = vi.hoisted(() => ({
  readCatalog: vi.fn<(path: string) => Promise<Page>>(),
  useDevices: vi.fn(),
}));

vi.mock("../api", () => ({
  readCatalog: mocks.readCatalog,
  useDevices: mocks.useDevices,
  entityName: (item: Entity) => item.title || item.name || item.id,
}));

vi.mock("../components/FlightMap", () => ({
  default: () => <div aria-label="飞行地图" />,
}));

// Exercise the board's filtering and navigation independently of chart rendering.
vi.mock("../components/CommandTaskCharts", () => ({
  HourlyChart: ({
    values,
    onSelect,
  }: {
    values: number[] | null;
    onSelect: (hour: number) => void;
  }) => (
    <div aria-label="任务时段图表">
      {values?.map((count, hour) => (
        <button key={hour} onClick={() => onSelect(hour)}>
          {`时段 ${hour}，${count} 项任务`}
        </button>
      ))}
    </div>
  ),
  RegionalChart: ({
    items,
    onSelect,
  }: {
    items: { region: string; count: number }[] | null;
    onSelect: (region: string) => void;
  }) => (
    <div aria-label="区域任务图表">
      {items?.map(({ region, count }) => (
        <button key={region} onClick={() => onSelect(region)}>
          {`区域 ${region}，${count} 项任务`}
        </button>
      ))}
    </div>
  ),
}));

const page = (items: Entity[]): Page => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});

const tasks: Entity[] = [
  {
    id: "midnight",
    title: "午夜跨日巡查",
    region: "上城区",
    status: "COMPLETED",
    startAt: "2026-10-15T16:00:00Z",
  },
  {
    id: "morning-late",
    title: "余杭早间巡查",
    region: "余杭区",
    status: "PENDING_EXECUTION",
    startAt: "2026-10-16T00:40:00Z",
  },
  {
    id: "morning-early",
    title: "上城早间巡查",
    region: "上城区",
    status: "COMPLETED",
    startAt: "2026-10-16T00:05:00Z",
  },
  {
    id: "unknown-region",
    title: "临安巡查",
    region: "临安区",
    status: "PENDING_ASSIGNMENT",
    startAt: "2026-10-16T04:30:00Z",
  },
  {
    id: "unassigned-region",
    title: "未分区巡查",
    status: "PENDING_ASSIGNMENT",
    startAt: "2026-10-16T05:00:00Z",
  },
  {
    id: "end-of-day",
    title: "余杭夜间巡查",
    region: "余杭区",
    status: "PENDING_EXECUTION",
    startAt: "2026-10-16T15:59:59Z",
  },
  {
    id: "previous-day",
    title: "昨日巡查",
    region: "上城区",
    status: "COMPLETED",
    startAt: "2026-10-15T15:59:59Z",
  },
  {
    id: "next-day",
    title: "明日巡查",
    region: "上城区",
    status: "PENDING_EXECUTION",
    startAt: "2026-10-16T16:00:00Z",
  },
  {
    id: "cancelled",
    title: "取消巡查",
    region: "上城区",
    status: "CANCELLED",
    startAt: "2026-10-16T00:15:00Z",
  },
  {
    id: "invalid-time",
    title: "无效时间巡查",
    region: "上城区",
    status: "PENDING_ASSIGNMENT",
    startAt: "invalid",
  },
  {
    id: "missing-time",
    title: "未排期巡查",
    region: "上城区",
    status: "PENDING_ASSIGNMENT",
  },
];

const clients: QueryClient[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T08:46:00Z"));
  mocks.readCatalog.mockImplementation(async (path) =>
    page(path === "/tasks" ? tasks : []),
  );
  mocks.useDevices.mockReturnValue({
    data: page([]),
    dataUpdatedAt: Date.now(),
    isError: false,
    isPending: false,
  });
});

afterEach(() => {
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
  await screen.findByRole(
    "button",
    { name: "时段 0，1 项任务" },
    { timeout: 5000 },
  );
  return navigate;
}

function taskNames(dialog: HTMLElement) {
  return within(within(dialog).getByRole("list", { name: "对应任务" }))
    .getAllByRole("button")
    .map((button) => button.querySelector("strong")?.textContent);
}

describe("指挥大屏图表任务联动", () => {
  it("按北京时间统计今日任务，排除相邻日期、取消和无效时间", async () => {
    await board();
    expect(
      screen.getByRole("button", { name: "区域 上城区，2 项任务" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "区域 余杭区，2 项任务" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "时段 23，1 项任务" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "时段 0，1 项任务" }));
    const dialog = screen.getByRole("dialog", { name: "任务时段明细" });
    expect(taskNames(dialog)).toEqual(["午夜跨日巡查"]);
    expect(within(dialog).getByText("00:00–00:59 · 全市")).toBeTruthy();
    expect(within(dialog).getByText("2026-10-16 · 北京时间")).toBeTruthy();
  });

  it("点击时段展示对应任务并按计划时间排序，行点击进入该任务", async () => {
    const navigate = await board();
    fireEvent.click(screen.getByRole("button", { name: "时段 8，2 项任务" }));
    const dialog = screen.getByRole("dialog", { name: "任务时段明细" });
    expect(taskNames(dialog)).toEqual(["上城早间巡查", "余杭早间巡查"]);
    expect(within(dialog).getByText("08:00–08:59 · 全市")).toBeTruthy();
    expect(dialog.querySelector(".command-drilldown-total")?.textContent).toBe(
      "2 项任务",
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: /上城早间巡查/ }),
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith("dispatch", {
      taskId: "morning-early",
    });
  });

  it("点击区域只展示该区今日有效任务", async () => {
    await board();
    fireEvent.click(
      screen.getByRole("button", { name: "区域 上城区，2 项任务" }),
    );
    const dialog = screen.getByRole("dialog", { name: "区域任务明细" });
    expect(taskNames(dialog)).toEqual(["午夜跨日巡查", "上城早间巡查"]);
    expect(
      within(dialog).getByText("上城区", { selector: "strong" }),
    ).toBeTruthy();
  });

  it("其他/未分区保留未知区域和未指定区域的任务", async () => {
    await board();
    fireEvent.click(
      screen.getByRole("button", { name: "区域 其他/未分区，2 项任务" }),
    );
    const dialog = screen.getByRole("dialog", { name: "区域任务明细" });
    expect(taskNames(dialog)).toEqual(["临安巡查", "未分区巡查"]);
    expect(within(dialog).getByText("其他/未分区")).toBeTruthy();
    expect(within(dialog).getByText("临安区")).toBeTruthy();
    expect(within(dialog).getByText("未分区")).toBeTruthy();
  });

  it("指挥区域筛选同步约束图表与时段明细", async () => {
    await board();
    fireEvent.click(screen.getByRole("combobox", { name: "指挥区域" }));
    fireEvent.click(screen.getByRole("option", { name: "余杭区" }));
    expect(screen.queryByRole("button", { name: /区域 上城区/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "时段 8，1 项任务" }));
    const dialog = screen.getByRole("dialog", { name: "任务时段明细" });
    expect(taskNames(dialog)).toEqual(["余杭早间巡查"]);
    expect(within(dialog).getByText("08:00–08:59 · 余杭区")).toBeTruthy();
  });

  it.each([
    ["时段 7，0 项任务", "任务时段明细", "07:00–07:59 · 全市"],
    ["区域 西湖区，0 项任务", "区域任务明细", "西湖区"],
  ])("点击零任务的%s仍展示明确空态", async (buttonName, title, scope) => {
    await board();
    fireEvent.click(screen.getByRole("button", { name: buttonName }));
    const dialog = screen.getByRole("dialog", { name: title });
    expect(within(dialog).getByText(scope)).toBeTruthy();
    expect(within(dialog).getByRole("status").textContent).toContain(
      "当前范围暂无任务",
    );
    expect(dialog.querySelector(".command-drilldown-total")?.textContent).toBe(
      "0 项任务",
    );
    expect(within(dialog).queryByRole("list", { name: "对应任务" })).toBeNull();
  });

  it("Escape 关闭明细后可以继续选择其他区域", async () => {
    await board();
    fireEvent.click(screen.getByRole("button", { name: "时段 8，2 项任务" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "区域 余杭区，2 项任务" }),
    );
    expect(
      taskNames(screen.getByRole("dialog", { name: "区域任务明细" })),
    ).toEqual(["余杭早间巡查", "余杭夜间巡查"]);
  });
});
