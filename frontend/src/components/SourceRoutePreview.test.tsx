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
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../api";
import type FlightMap from "./FlightMap";
import SourceRoutePreview from "./SourceRoutePreview";
import SourceRecords from "./SourceRecords";

const map = vi.hoisted(() => ({
  calls: [] as ComponentProps<typeof FlightMap>[],
}));
vi.mock("./FlightMap", () => ({
  default: (props: ComponentProps<typeof FlightMap>) => {
    map.calls.push(props);
    return (
      <output aria-label="WGS84航线地图">
        {JSON.stringify(props.objects)}
      </output>
    );
  },
}));
const coordinates = [
  [120.123456789, 30.987654321, 0, 7],
  [120.124, 30.988, 91.375, 8],
  [120.125, 30.989],
];
const route: Entity = {
  id: "source-route-900719925474099312345",
  title: "合成来源航线",
  coordinateReference: "SOURCE_MAP_UNSPECIFIED",
  geometry: { type: "LineString", coordinates },
  geometryStatus: "AVAILABLE",
  heightMeters: 100,
};
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  map.calls.length = 0;
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

describe("来源航线只读预览", () => {
  it("来源基准未说明时只绘制无底图点序，不把来源Z或缺失值当AGL", () => {
    const original = JSON.stringify(route);
    render(<SourceRoutePreview record={route} />);
    expect(
      screen.getByRole("img", { name: "来源航线点序示意，无地理底图" }),
    ).toBeTruthy();
    expect(map.calls).toHaveLength(0);
    expect(screen.getByText(/来源坐标基准未确认为 WGS84/)).toBeTruthy();
    const rows = within(screen.getByRole("table", { name: "来源航点原始坐标" }))
      .getAllByRole("row")
      .slice(1);
    expect(
      within(rows[0])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["120.123456789", "30.987654321", "0", "[7]"]);
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["120.124", "30.988", "91.375", "[8]"]);
    expect(
      within(rows[2])
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["120.125", "30.989", "未提供", "未提供"]);
    expect(screen.getByText(/关闭此弹窗，切换上方“本地业务档案”/)).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "查看本地航线档案" }),
    ).toBeNull();
    expect(JSON.stringify(route)).toBe(original);
  });

  it("明确WGS84且完整合法的航线使用平面地图，仍原样保留Z且没有绘制入口", () => {
    render(
      <SourceRoutePreview
        record={{ ...route, coordinateReference: "WGS84" }}
      />,
    );
    const props = map.calls.at(-1)!;
    expect(props.initialThreeD).toBe(false);
    expect(props.drawing).toBeUndefined();
    expect(props.onMapPoint).toBeUndefined();
    expect(props.objects?.[0].geometry).toEqual(route.geometry);
    expect(props.objects?.[0]).not.toHaveProperty("geometryContext");
    expect(
      screen.getByRole("columnheader", { name: "经度（WGS84）" }),
    ).toBeTruthy();
    expect(screen.queryByRole("img", { name: /来源航线点序示意/ })).toBeNull();
  });

  it("本地档案入口只传回来源记录，不触发导入或保存", () => {
    const onOpenLocalArchive = vi.fn();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <SourceRoutePreview
        record={route}
        onOpenLocalArchive={onOpenLocalArchive}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看本地航线档案" }));
    expect(onOpenLocalArchive).toHaveBeenCalledExactlyOnceWith(route);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, "GCJ02", "AMSL", "wgs84"])(
    "坐标基准%j不自动解释为WGS84",
    (coordinateReference) => {
      render(<SourceRoutePreview record={{ ...route, coordinateReference }} />);
      expect(map.calls).toHaveLength(0);
      expect(screen.getByRole("img", { name: /无地理底图/ })).toBeTruthy();
    },
  );

  it("WGS84声明但坐标越界时拒绝地图定位，原始坐标仍可核对", () => {
    render(
      <SourceRoutePreview
        record={{
          ...route,
          coordinateReference: "WGS84",
          geometry: {
            type: "LineString",
            coordinates: [
              [220, 30, 80],
              [221, 31],
            ],
          },
        }}
      />,
    );
    expect(map.calls).toHaveLength(0);
    expect(screen.getByText(/经纬度超出有效范围/)).toBeTruthy();
    expect(screen.getByRole("cell", { name: "220" })).toBeTruthy();
  });

  it.each([
    { geometry: null, message: "来源未返回可预览的航点几何" },
    { geometry: "{invalid", message: "来源几何格式无法解析" },
    {
      geometry: { type: "Point", coordinates: [120, 30] },
      message: "来源几何不是有效的 LineString",
    },
    {
      geometry: { type: "LineString", coordinates: [[120, 30]] },
      message: "来源航点不足 2 个",
    },
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [120, 30],
          [120.1, 30.1, Infinity],
          [120.2, 30.2],
        ],
      },
      message: "来源航点包含无效坐标",
    },
    {
      geometry: {
        type: "LineString",
        coordinates: [
          ["120", 30],
          [120.1, 30.1],
        ],
      },
      message: "来源航点包含无效坐标",
    },
  ])(
    "缺失或非法几何明确显示原因而不拼接有效点：$message",
    ({ geometry, message }) => {
      render(<SourceRoutePreview record={{ ...route, geometry }} />);
      expect(screen.getByRole("status").textContent).toContain(message);
      expect(screen.queryByRole("table")).toBeNull();
      expect(screen.queryByRole("img")).toBeNull();
      expect(map.calls).toHaveLength(0);
    },
  );

  it("长航线完整保留连线但表格分页，原始字段只在展开后渲染", async () => {
    const points = Array.from({ length: 103 }, (_, index) => [
      120 + index / 10000,
      30 + index / 10000,
      index,
    ]);
    const parameters = { customSourceField: "保留原始参数" };
    const { container } = render(
      <SourceRoutePreview
        record={{
          ...route,
          geometry: JSON.stringify({
            type: "Feature",
            geometry: { type: "LineString", coordinates: points },
          }),
          parameters,
        }}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(21);
    expect(
      container.querySelector("polyline")?.getAttribute("points")?.split(" "),
    ).toHaveLength(103);
    expect(container.querySelector("pre")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一页航点" }));
    expect(screen.getByRole("rowheader", { name: "航点 21" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "航点 1" })).toBeNull();
    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() =>
      expect(container.querySelectorAll("pre")).toHaveLength(2),
    );
    expect(container.querySelectorAll("pre")[1].textContent).toContain(
      "保留原始参数",
    );
  });

  it("密集航点只标注间距足够的数字，保留页内全部圆点、首尾和完整连线", () => {
    const points = Array.from({ length: 45 }, (_, index) => [
      120.11 + index * 0.0001,
      30.25 + Math.sin(index / 4) * 0.0007,
    ]);
    const { container } = render(
      <SourceRoutePreview
        record={{
          ...route,
          geometry: { type: "LineString", coordinates: points },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "下一页航点" }));
    const diagram = container.querySelector("svg")!;
    expect(diagram.querySelectorAll("circle")).toHaveLength(22);
    expect(diagram.querySelectorAll("g > title")).toHaveLength(22);
    expect(
      [...diagram.querySelectorAll("g > title")].map(
        (title) => title.textContent,
      ),
    ).toEqual([
      "来源航点 1",
      ...Array.from({ length: 20 }, (_, index) => `来源航点 ${index + 21}`),
      "来源航点 45",
    ]);
    expect(
      diagram.querySelector("polyline")?.getAttribute("points")?.split(" "),
    ).toHaveLength(45);
    const labels = [...diagram.querySelectorAll("text")];
    expect(labels.length).toBeLessThan(22);
    expect(labels.map((label) => label.textContent)).toContain("1");
    expect(labels.map((label) => label.textContent)).toContain("45");
    for (let index = 0; index < labels.length; index++) {
      for (const next of labels.slice(index + 1)) {
        const current = labels[index];
        const gapX = Math.abs(
          Number(current.getAttribute("x")) - Number(next.getAttribute("x")),
        );
        const gapY = Math.abs(
          Number(current.getAttribute("y")) - Number(next.getAttribute("y")),
        );
        expect(gapX >= 32 || gapY >= 20).toBe(true);
      }
    }
    expect(screen.getAllByRole("row")).toHaveLength(21);
    expect(screen.getByRole("rowheader", { name: "航点 21" })).toBeTruthy();
  });

  it("sourceGeometry的GeoJSON可只读预览，极端但有限的来源XY不会使示意图产生NaN", () => {
    const { container } = render(
      <SourceRoutePreview
        record={{
          ...route,
          geometry: null,
          sourceGeometry: {
            type: "LineString",
            coordinates: [
              [-1e308, 1e308],
              [1e308, -1e308],
            ],
          },
        }}
      />,
    );
    expect(
      container.querySelector("polyline")?.getAttribute("points"),
    ).not.toMatch(/NaN|Infinity/);
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("来源目录打开详情即可看到航线预览与字段，全程只请求来源查询", async () => {
    const requests: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, options?: RequestInit) => {
        requests.push({ url: input, method: options?.method || "GET" });
        return new Response(
          JSON.stringify({
            code: "SUCCESS",
            data: { items: [route], total: 1, page: 1, pageSize: 100 },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const onOpenLocalArchive = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <SourceRecords kind="routes" onOpenLocalArchive={onOpenLocalArchive} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText(route.title!));
    const dialog = screen.getByRole("dialog", { name: route.title });
    expect(
      within(dialog).getByRole("region", { name: "来源航线预览" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByText("source-route-900719925474099312345"),
    ).toBeTruthy();
    expect(within(dialog).getByText("来源高度（米，基准未说明）")).toBeTruthy();
    expect(
      requests.every(
        (request) =>
          request.url.startsWith("/api/v1/source-data/routes?") &&
          request.method === "GET",
      ),
    ).toBe(true);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "查看本地航线档案" }),
    );
    expect(onOpenLocalArchive).toHaveBeenCalledExactlyOnceWith(route);
    expect(screen.queryByRole("dialog", { name: route.title })).toBeNull();
  });
});
