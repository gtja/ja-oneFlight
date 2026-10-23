// @vitest-environment jsdom
import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FlightMap, { type AreaFocusRequest } from "./FlightMap";
import { buildingFromFeature } from "./mapBuildings";
import type { Feature } from "geojson";
import { airspaceShapePoints } from "../airspaceShapes";

const harness = vi.hoisted(() => {
  type Insets = { left: number; right: number; top: number; bottom: number };
  const instances: FakeMap[] = [];
  const markers: FakeMarker[] = [];
  class FakeMarker {
    point: [number, number] = [0, 0];
    handlers = new Map<string, () => void>();
    removed = false;
    constructor(public options: { element: HTMLElement; draggable?: boolean }) {
      markers.push(this);
    }
    setLngLat(point: [number, number]) {
      this.point = point;
      return this;
    }
    addTo() {
      document.body.append(this.options.element);
      return this;
    }
    on(name: string, callback: () => void) {
      this.handlers.set(name, callback);
      return this;
    }
    getLngLat() {
      return { lng: this.point[0], lat: this.point[1] };
    }
    remove() {
      this.removed = true;
      this.options.element.remove();
    }
  }
  class FakeMap {
    calls: string[] = [];
    focusPoints: number[][] = [];
    flyCalls: { center: number[]; zoom?: number; duration?: number }[] = [];
    flyEventData: unknown[] = [];
    handlers = new Map<string, (...args: never[]) => void>();
    layers = new Map<string, unknown>();
    sourceOptions = new Map<string, unknown>();
    paintCalls: unknown[][] = [];
    layoutCalls: unknown[][] = [];
    fits: unknown[][] = [];
    cameraBoundsCalls: unknown[][] = [];
    padding = { left: 0, right: 0, top: 0, bottom: 0 };
    features: unknown[] = [];
    zoom = 16;
    sources = new Map<string, { setData: () => void }>();
    terrain: object | null = null;
    canvas = document.createElement("canvas");
    constructor(public options: { style: unknown }) {
      instances.push(this);
    }
    on(name: string, callback: (...args: never[]) => void) {
      this.handlers.set(name, callback);
    }
    off(name: string) {
      this.handlers.delete(name);
    }
    getCanvas() {
      return this.canvas;
    }
    getSource(name: string) {
      return this.sources.get(name);
    }
    addSource(name: string, options: unknown) {
      this.sourceOptions.set(name, options);
      this.sources.set(name, { setData: vi.fn() });
    }
    addLayer(layer: { id: string }) {
      this.layers.set(layer.id, layer);
    }
    getLayer(name: string) {
      return this.layers.get(name);
    }
    removeLayer(name: string) {
      this.layers.delete(name);
    }
    setLayoutProperty(...args: unknown[]) {
      this.layoutCalls.push(args);
    }
    setPaintProperty(...args: unknown[]) {
      this.paintCalls.push(args);
    }
    queryRenderedFeatures() {
      return this.features;
    }
    getZoom() {
      return this.zoom;
    }
    getPitch() {
      return 60;
    }
    getBearing() {
      return -22;
    }
    setPadding(padding: Insets) {
      this.padding = padding;
    }
    cameraForBounds(
      bounds: number[][],
      options: {
        padding: Insets;
        bearing: number;
        maxZoom: number;
      },
    ) {
      this.cameraBoundsCalls.push([bounds, options, this.padding]);
      // Model MapLibre's addition of persistent and per-request padding.
      if (
        this.padding.left +
          this.padding.right +
          options.padding.left +
          options.padding.right >=
        1000
      )
        return;
      return {
        center: [
          (bounds[0][0] + bounds[1][0]) / 2,
          (bounds[0][1] + bounds[1][1]) / 2,
        ],
        zoom: options.maxZoom,
        bearing: options.bearing,
      };
    }
    isSourceLoaded() {
      return true;
    }
    fitBounds(...args: unknown[]) {
      this.fits.push(args);
    }
    getTerrain() {
      return this.terrain;
    }
    setTerrain(value: object | null) {
      this.calls.push(value ? "terrain:on" : "terrain:off");
      this.terrain = value;
    }
    setStyle() {
      this.calls.push("style");
      this.sources.clear();
      this.layers.clear();
    }
    flyTo(
      options: {
        center: number[];
        zoom?: number;
        duration?: number;
        padding?: Insets;
      },
      eventData?: unknown,
    ) {
      this.focusPoints.push(options.center);
      this.flyCalls.push(options);
      this.flyEventData.push(eventData);
      if (options.padding) this.padding = options.padding;
    }
    easeTo() {
      this.calls.push("ease");
    }
    resize() {
      this.calls.push("resize");
    }
    stop() {
      this.calls.push("stop");
    }
    remove() {
      this.calls.push("remove");
    }
    doubleClickZoom = { disable() {} };
  }
  return {
    FakeMap,
    FakeMarker,
    markers,
    instances,
    config: {
      mapStyleUrl: "https://example.test/electronic.json",
      mapSatelliteUrl: "https://example.test/imagery/{z}/{x}/{y}.png",
      mapTerrainUrl: "https://example.test/terrain/{z}/{x}/{y}.png",
    },
  };
});
vi.mock("maplibre-gl", () => ({
  default: { Map: harness.FakeMap, Marker: harness.FakeMarker },
}));
vi.mock("../api", () => ({ useData: () => ({ data: harness.config }) }));
vi.mock("./FlightSimulation3D", () => ({
  default: ({
    map,
    ready,
    styleEpoch,
    threeD,
    onRequest3D,
    reports,
    definitions,
    streamKey,
  }: {
    map: unknown;
    ready: boolean;
    styleEpoch: number;
    threeD: boolean;
    onRequest3D: () => void;
    reports?: readonly unknown[];
    definitions?: readonly unknown[];
    streamKey?: string;
  }) => (
    <button
      data-testid="simulation-bridge"
      data-map={Boolean(map)}
      data-ready={ready}
      data-style-epoch={styleEpoch}
      data-three-d={threeD}
      data-source-mode={reports === undefined ? "demo" : "reports"}
      data-report-count={reports?.length}
      data-definition-count={definitions?.length}
      data-stream-key={streamKey}
      onClick={onRequest3D}
    >
      请求飞行近览
    </button>
  ),
}));
const resizeCallbacks: Array<() => void> = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    disconnect() {}
  },
);
afterEach(() => {
  cleanup();
  harness.instances.length = 0;
  harness.markers.length = 0;
  resizeCallbacks.length = 0;
  vi.unstubAllGlobals();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});

describe("地图样式与生命周期", () => {
  it("外部空上报也启用真实数据入口并透传批次、机队定义和飞行会话", () => {
    const definitions = [
      { deviceId: "uav-1", name: "巡检无人机", kind: "multirotor" as const },
    ];
    const view = render(
      <FlightMap
        flightReports={[]}
        aircraftDefinitions={definitions}
        flightStreamKey="mission-1"
      />,
    );
    const bridge = screen.getByTestId("simulation-bridge");
    expect(bridge.dataset.sourceMode).toBe("reports");
    expect(bridge.dataset.reportCount).toBe("0");
    expect(bridge.dataset.definitionCount).toBe("1");
    expect(bridge.dataset.streamKey).toBe("mission-1");
    const reports = [
      {
        deviceId: "uav-1",
        timestamp: Date.UTC(2026, 9, 16),
        longitude: 120.17,
        latitude: 30.23,
        altitudeMeters: 100,
        altitudeReference: "AGL" as const,
      },
    ];
    view.rerender(
      <FlightMap
        flightReports={reports}
        aircraftDefinitions={definitions}
        flightStreamKey="mission-1"
      />,
    );
    expect(bridge.dataset.reportCount).toBe("1");
    view.rerender(
      <FlightMap
        flightReports={[]}
        aircraftDefinitions={definitions}
        flightStreamKey="mission-2"
      />,
    );
    expect(bridge.dataset.sourceMode).toBe("reports");
    expect(bridge.dataset.streamKey).toBe("mission-2");
    expect(harness.instances).toHaveLength(1);
  });
  it("普通地图不挂载机队，大屏桥接就绪和底图生命周期，并允许请求3D", () => {
    const view = render(<FlightMap />);
    expect(screen.queryByTestId("simulation-bridge")).toBeNull();
    view.rerender(<FlightMap simulation />);
    const bridge = screen.getByTestId("simulation-bridge");
    expect(bridge.dataset.ready).toBe("false");
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(bridge.dataset.map).toBe("true");
    expect(bridge.dataset.ready).toBe("true");
    expect(bridge.dataset.styleEpoch).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(bridge.dataset.threeD).toBe("false");
    fireEvent.click(bridge);
    expect(bridge.dataset.threeD).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    expect(bridge.dataset.ready).toBe("false");
    act(() => map.handlers.get("style.load")?.());
    expect(bridge.dataset.ready).toBe("true");
    expect(bridge.dataset.styleEpoch).toBe("2");
    view.rerender(<FlightMap />);
    expect(screen.queryByTestId("simulation-bridge")).toBeNull();
  });
  it("有地形时先停止动画并销毁旧地形，再切底图，加载后恢复3D", () => {
    const view = render(<FlightMap />);
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.getTerrain()).not.toBeNull();
    map.calls.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    expect(map.calls).toEqual(["stop", "terrain:off", "style"]);
    act(() => map.handlers.get("style.load")?.());
    expect(map.getTerrain()).not.toBeNull();
    map.calls.length = 0;
    view.unmount();
    expect(map.calls).toEqual(["stop", "terrain:off", "remove"]);
  });
  it("StrictMode每个实例直接用缓存配置初始化，卸载后忽略迟到回调", () => {
    const view = render(
      <StrictMode>
        <FlightMap />
      </StrictMode>,
    );
    expect(harness.instances).toHaveLength(2);
    for (const map of harness.instances) {
      expect(map.calls).not.toContain("style");
      expect(JSON.stringify(map.options.style)).toContain(
        harness.config.mapSatelliteUrl,
      );
    }
    const map = harness.instances[1];
    const lateStyleLoad = map.handlers.get("style.load");
    const lateResize = resizeCallbacks[1];
    view.unmount();
    const calls = [...map.calls];
    act(() => {
      lateStyleLoad?.();
      lateResize?.();
    });
    expect(map.calls).toEqual(calls);
    expect(map.handlers.size).toBe(0);
  });
});

describe("关联设备定位", () => {
  it("空域范围预览按完整几何定位，轮询同一对象不重新适配", () => {
    const area = {
      id: "preview",
      kind: "AIRSPACE",
      metadata: {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [120, 30],
              [120.2, 30],
              [120.2, 30.2],
              [120, 30],
            ],
          ],
        },
      },
    };
    const view = render(
      <FlightMap compact initialThreeD={false} focusObject={area} />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.fits).toEqual([
      [
        [
          [120, 30],
          [120.2, 30.2],
        ],
        { padding: 48, maxZoom: 16, duration: 500 },
      ],
    ]);
    expect(
      screen.getByRole("button", { name: "2D" }).getAttribute("aria-pressed"),
    ).toBe("true");
    view.rerender(
      <FlightMap compact initialThreeD={false} focusObject={{ ...area }} />,
    );
    expect(map.fits).toHaveLength(1);
  });
  it("等待真实坐标后定位一次，缺失坐标不跳到其他设备", () => {
    const view = render(
      <FlightMap
        focusObject={{ id: "assigned", longitude: null, latitude: null }}
      />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.focusPoints).toEqual([]);
    view.rerender(
      <FlightMap
        focusObject={{ id: "assigned", longitude: 120.1, latitude: 30.2 }}
      />,
    );
    expect(map.focusPoints).toEqual([[120.1, 30.2]]);
    view.rerender(
      <FlightMap
        focusObject={{ id: "assigned", longitude: 120.2, latitude: 30.3 }}
      />,
    );
    expect(map.focusPoints).toHaveLength(1);
    view.rerender(
      <FlightMap
        focusObject={{ id: "next", longitude: 121.1, latitude: 31.2 }}
      />,
    );
    expect(map.focusPoints).toEqual([
      [120.1, 30.2],
      [121.1, 31.2],
    ]);
  });
});

const businessObjects = [
  {
    id: "dock",
    kind: "DOCK",
    title: "一号起降场",
    longitude: 120.1,
    latitude: 30.2,
  },
  {
    id: "route",
    kind: "ROUTE",
    title: "巡检航线",
    metadata: {
      geometry: {
        type: "LineString",
        coordinates: [
          [120.1, 30.2],
          [120.4, 30.5],
        ],
      },
    },
  },
  {
    id: "area",
    kind: "AIRSPACE",
    title: "保障空域",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [120.2, 30.3],
          [120.3, 30.3],
          [120.3, 30.4],
          [120.2, 30.3],
        ],
      ],
    },
  },
];
describe("大屏地图对象交互", () => {
  it("标记和几何标签均可聚焦选择，选中更新保留原按钮与键盘焦点", () => {
    const onSelect = vi.fn();
    const view = render(
      <FlightMap objects={businessObjects} onSelect={onSelect} />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    const dock = screen.getByRole("button", { name: "一号起降场" });
    const route = screen.getByRole("button", { name: "巡检航线" });
    expect(route.tabIndex).toBe(0);
    expect(route.title).toContain("查看航线");
    route.focus();
    fireEvent.click(route, { detail: 0 });
    expect(onSelect).toHaveBeenCalledWith(businessObjects[1]);
    view.rerender(
      <FlightMap
        objects={businessObjects}
        onSelect={onSelect}
        selectedObjectId="route"
      />,
    );
    expect(
      screen.getByRole("button", { name: "巡检航线", pressed: true }),
    ).toBe(route);
    expect(document.activeElement).toBe(route);
    expect(dock.getAttribute("aria-pressed")).toBe("false");
    expect(map.getSource("business")?.setData).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              id: "route",
              selected: true,
            }),
          }),
          expect.objectContaining({
            properties: expect.objectContaining({
              id: "area",
              selected: false,
            }),
          }),
        ]),
      }),
    );
    expect(map.focusPoints).toEqual([]);
  });
  it("画布仅拾取业务图层中真实ID，隐藏图层或绘制时不误选底图对象", () => {
    const onSelect = vi.fn();
    const view = render(
      <FlightMap objects={businessObjects} onSelect={onSelect} />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    map.features = [
      {
        source: "other",
        layer: { id: "business-line" },
        properties: { id: "route" },
      },
      {
        source: "business",
        layer: { id: "building" },
        properties: { id: "route" },
      },
      {
        source: "business",
        layer: { id: "business-line" },
        properties: { id: "unknown" },
      },
    ];
    clickMap(map);
    expect(onSelect).not.toHaveBeenCalled();
    map.features = [
      {
        source: "business",
        layer: { id: "business-hit" },
        properties: { id: "route" },
      },
    ];
    clickMap(map);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(businessObjects[1]);
    act(() =>
      map.handlers.get("mousemove")?.({ point: { x: 200, y: 150 } } as never),
    );
    expect(map.canvas.style.cursor).toBe("pointer");
    expect(screen.getByRole("tooltip").textContent).toContain("巡检航线");
    act(() => map.handlers.get("movestart")?.());
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(map.canvas.style.cursor).toBe("");
    view.rerender(
      <FlightMap
        objects={businessObjects}
        onSelect={onSelect}
        layers={{ airspace: false }}
      />,
    );
    clickMap(map);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "巡检航线" })).toBeNull();
    const onMapPoint = vi.fn();
    view.rerender(
      <FlightMap
        objects={businessObjects}
        onSelect={onSelect}
        onMapPoint={onMapPoint}
      />,
    );
    clickMap(map);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onMapPoint).toHaveBeenCalledExactlyOnceWith([120.16, 30.27]);
  });
  it("显式定位等待就绪，可重复定位同一对象；样式重载和选中更新不重放请求", () => {
    const request = { entity: businessObjects[1], revision: 1 };
    const view = render(
      <FlightMap objects={businessObjects} focusRequest={request} />,
    );
    const map = harness.instances[0];
    expect(map.cameraBoundsCalls).toHaveLength(0);
    act(() => map.handlers.get("style.load")?.());
    expect(map.cameraBoundsCalls).toEqual([
      [
        [
          [120.1, 30.2],
          [120.4, 30.5],
        ],
        {
          padding: { left: 48, right: 48, top: 48, bottom: 48 },
          bearing: -22,
          maxZoom: 15.5,
        },
        { top: 0, right: 0, bottom: 0, left: 0 },
      ],
    ]);
    view.rerender(
      <FlightMap
        objects={businessObjects}
        focusRequest={request}
        selectedObjectId="route"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    act(() => map.handlers.get("style.load")?.());
    expect(map.cameraBoundsCalls).toHaveLength(1);
    view.rerender(
      <FlightMap
        objects={businessObjects}
        focusRequest={{ ...request, revision: 2 }}
      />,
    );
    expect(map.cameraBoundsCalls).toHaveLength(2);
    view.rerender(
      <FlightMap
        objects={businessObjects}
        focusRequest={{ entity: businessObjects[0], revision: 3 }}
      />,
    );
    expect(map.flyCalls.at(-1)).toMatchObject({
      center: [120.1, 30.2],
      offset: [0, 0],
      pitch: 60,
      bearing: -22,
      duration: 650,
    });
    expect(map.flyEventData.at(-1)).toEqual({ businessObjectFocus: true });
    expect(map.flyCalls.at(-1)).not.toHaveProperty("padding");
    expect(map.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    // A previous camera (or an interrupted legacy transition) can leave large
    // persistent insets. They must be cleared before fitting the next geometry.
    map.padding = { left: 400, right: 600, top: 300, bottom: 300 };
    const before = map.flyCalls.length;
    view.rerender(
      <FlightMap
        objects={businessObjects}
        focusRequest={{ entity: businessObjects[2], revision: 4 }}
      />,
    );
    expect(map.flyCalls).toHaveLength(before + 1);
    expect(map.flyCalls.at(-1)).toMatchObject({
      center: [120.25, 30.35],
      pitch: 60,
      bearing: -22,
    });
    expect(map.cameraBoundsCalls.at(-1)?.[2]).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(map.padding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it("镜头预留继承面板空间并压缩过大padding，减少动态效果时直接定位", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const view = render(
      <div
        style={
          {
            "--board-left": "400px",
            "--board-right": "200px",
            "--board-focus-right": "600px",
            "--board-top": "300px",
            "--board-bottom": "300px",
          } as import("react").CSSProperties
        }
      >
        <FlightMap focusRequest={{ entity: businessObjects[0], revision: 1 }} />
      </div>,
    );
    const canvas = view.container.querySelector(".map-canvas")!;
    Object.defineProperties(canvas, {
      clientWidth: { value: 1000 },
      clientHeight: { value: 600 },
    });
    // JSDOM does not inherit CSS custom properties, so mirror computed browser values.
    (canvas as HTMLElement).style.cssText =
      "--board-left:400px;--board-right:200px;--board-focus-right:600px;--board-top:300px;--board-bottom:300px";
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls.at(-1)).toMatchObject({
      duration: 0,
      offset: [-76, 0],
    });
    expect(
      screen.getByRole("button", { name: "3D", pressed: true }).title,
    ).toContain("三维");
    expect(
      screen.getByRole("button", { name: "影像", pressed: true }).title,
    ).toContain("影像");
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    expect(
      screen.getByRole("button", { name: "电子图", pressed: true }),
    ).toBeTruthy();
  });
  it("大屏定位按飞行控制栏的实际高度避让新增状态行", () => {
    const view = render(
      <FlightMap focusRequest={{ entity: businessObjects[0], revision: 1 }} />,
    );
    const holder = view.container.querySelector<HTMLElement>(".map-canvas")!;
    holder.style.setProperty("--board-top", "100px");
    Object.defineProperty(holder, "clientHeight", { value: 1000 });
    const controls = document.createElement("div");
    controls.className = "flight-sim-controls";
    vi.spyOn(controls, "getBoundingClientRect").mockReturnValue({
      bottom: 300,
      height: 60,
    } as DOMRect);
    holder.parentElement!.append(controls);
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls.at(-1)).toMatchObject({ offset: [0, 138] });
  });
});

const sourceBuilding = {
  type: "Feature",
  id: "13673454710",
  properties: { render_height: 70 },
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [120.1, 30.2],
        [120.2, 30.2],
        [120.2, 30.4],
        [120.1, 30.2],
      ],
    ],
  },
};
const editor = (overrides = {}) => ({
  mode: "ROUTE" as const,
  points: [
    [120.1, 30.2],
    [120.2, 30.3],
  ] as [number, number][],
  selectedIndex: 0,
  interaction: "draw" as "draw" | "inspect",
  onSelect: vi.fn(),
  onMove: vi.fn(),
  ...overrides,
});
function clickMap(map: InstanceType<typeof harness.FakeMap>) {
  const event = {
    originalEvent: { target: map.getCanvas() },
    point: { x: 1, y: 1 },
    lngLat: { lng: 120.16, lat: 30.27 },
  };
  act(() => map.handlers.get("click")?.(event as never));
}
describe("航线编辑与真实楼宇", () => {
  it("大跨度航线首次按所选点进入街区立体近览，总览后可一键回到真实高度近览", () => {
    const drawing = editor({
      points: [
        [120.1, 30.2],
        [120.6, 30.5],
      ],
      heightMeters: [100, 100],
      selectedIndex: 1,
    });
    const view = render(<FlightMap drawing={drawing} />);
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.fits).toHaveLength(0);
    expect(map.flyCalls).toHaveLength(1);
    expect(map.flyCalls[0]).toMatchObject({
      center: [120.6, 30.5],
      zoom: 17.2,
      pitch: 60,
      offset: [0, 102],
    });
    fireEvent.click(screen.getByRole("button", { name: "全线总览" }));
    expect(map.fits).toHaveLength(1);
    expect(map.fits[0][0]).toEqual([
      [120.1, 30.2],
      [120.6, 30.5],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "立体近览" }));
    expect(map.flyCalls).toHaveLength(2);
    expect(map.flyCalls[1]).toMatchObject({
      center: [120.6, 30.5],
      zoom: 17.2,
      pitch: 60,
    });
    view.rerender(<FlightMap drawing={{ ...drawing, selectedIndex: 0 }} />);
    expect(map.flyCalls).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "立体近览" }));
    expect(map.flyCalls.at(-1)).toMatchObject({
      center: [120.1, 30.2],
      zoom: 17.2,
    });
  });
  it("3D侧栏定位和全屏重建使用近览；不继承全线的城市级缩放", () => {
    const drawing = editor({ heightMeters: [100, 100] });
    const view = render(<FlightMap drawing={drawing} />);
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    fireEvent.click(screen.getByRole("button", { name: "全线总览" }));
    map.zoom = 11;
    view.rerender(
      <FlightMap
        drawing={{ ...drawing, focusRequest: { index: 1, revision: 1 } }}
      />,
    );
    expect(map.flyCalls.at(-1)).toMatchObject({
      center: [120.2, 30.3],
      zoom: 17.2,
      pitch: 60,
    });
    view.unmount();
    render(<FlightMap drawing={{ ...drawing, selectedIndex: 1 }} />);
    const fullscreen = harness.instances[1];
    act(() => fullscreen.handlers.get("style.load")?.());
    expect(fullscreen.fits).toHaveLength(0);
    expect(fullscreen.flyCalls[0]).toMatchObject({
      center: [120.2, 30.3],
      zoom: 17.2,
      pitch: 60,
    });
  });
  it("仅编辑卫星影像提高亮度和对比，电子图及普通地图保留原配色", () => {
    const view = render(<FlightMap drawing={editor()} />);
    const map = harness.instances[0];
    expect(map.options.style).toMatchObject({
      layers: [
        {
          paint: {
            "raster-saturation": -0.12,
            "raster-brightness-max": 0.9,
            "raster-contrast": 0.08,
          },
        },
      ],
    });
    view.unmount();
    render(<FlightMap />);
    expect(harness.instances[1].options.style).toMatchObject({
      layers: [
        {
          paint: {
            "raster-saturation": -0.35,
            "raster-brightness-max": 0.72,
            "raster-contrast": 0,
          },
        },
      ],
    });
  });
  it("航线默认真实3D自定义层并隐藏贴地线；2D可编辑，空域保持默认2D", () => {
    const view = render(
      <FlightMap drawing={editor({ heightMeters: [100, 160] })} />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.layers.get("drawing-route-elevated")).toMatchObject({
      type: "custom",
      renderingMode: "3d",
    });
    expect(map.getTerrain()).toEqual({ source: "terrain", exaggeration: 1 });
    expect(map.layoutCalls).toContainEqual([
      "drawing-line",
      "visibility",
      "none",
    ]);
    expect(harness.markers).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    expect(map.layers.has("drawing-route-elevated")).toBe(false);
    expect(map.layoutCalls).toContainEqual([
      "drawing-line",
      "visibility",
      "visible",
    ]);
    expect(harness.markers).toHaveLength(2);
    view.unmount();
    render(<FlightMap drawing={editor({ mode: "AIRSPACE" })} />);
    const airspace = harness.instances[1];
    act(() => airspace.handlers.get("style.load")?.());
    expect(airspace.layers.has("drawing-route-elevated")).toBe(false);
    expect(airspace.getTerrain()).toBeNull();
  });
  it("2D使用清晰绿色实线描边和编号首末航点，自动适配一次；选择不反复缩放", () => {
    const drawing = editor();
    const view = render(<FlightMap drawing={drawing} />);
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.layers.get("drawing-line")).toMatchObject({
      paint: { "line-width": 4, "line-color": "#16e6a7" },
    });
    expect(map.layers.get("drawing-casing")).toMatchObject({
      paint: { "line-width": 8 },
    });
    expect(
      screen.getByRole("button", { name: "航点 1 · 起点，可拖动调整" })
        .textContent,
    ).toBe("1");
    expect(
      screen.getByRole("button", { name: "航点 2 · 终点，可拖动调整" })
        .textContent,
    ).toBe("2");
    expect(map.fits).toHaveLength(1);
    view.rerender(<FlightMap drawing={{ ...drawing, selectedIndex: 1 }} />);
    expect(map.fits).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "全线总览" }));
    expect(map.fits).toHaveLength(2);
  });
  it("拖动完成才变更坐标；拖动开始不触发重绘销毁marker", () => {
    const drawing = editor();
    render(<FlightMap drawing={drawing} />);
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    const marker = harness.markers[0];
    marker.handlers.get("dragstart")?.();
    expect(drawing.onSelect).not.toHaveBeenCalled();
    marker.point = [120.166, 30.288];
    act(() => marker.handlers.get("dragend")?.());
    expect(drawing.onMove).toHaveBeenCalledWith(0, [120.166, 30.288]);
    expect(drawing.onSelect).toHaveBeenCalledWith(0);
  });
  it("draw点击添加航点，inspect只选择真实建筑且不添加航点；隐藏楼宇不误选", () => {
    const onMapPoint = vi.fn(),
      onBuildingSelect = vi.fn();
    const drawing = editor();
    const view = render(
      <FlightMap
        drawing={drawing}
        onMapPoint={onMapPoint}
        onBuildingSelect={onBuildingSelect}
      />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    map.features = [sourceBuilding];
    clickMap(map);
    expect(onMapPoint).toHaveBeenCalledWith([120.16, 30.27]);
    expect(onBuildingSelect).not.toHaveBeenCalled();
    view.rerender(
      <FlightMap
        drawing={{ ...drawing, interaction: "inspect" }}
        onMapPoint={onMapPoint}
        onBuildingSelect={onBuildingSelect}
      />,
    );
    clickMap(map);
    expect(onMapPoint).toHaveBeenCalledTimes(1);
    expect(onBuildingSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^13673454710:polygon:/),
        heightMeters: null,
        source: "OpenFreeMap / OpenStreetMap",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "楼宇" }));
    clickMap(map);
    expect(onBuildingSelect).toHaveBeenCalledTimes(1);
    expect(map.layoutCalls).toContainEqual([
      "context-buildings-2d",
      "visibility",
      "none",
    ]);
  });
  it("影像/电子图切换后重建建筑和编辑图层，3D切换保持相同源坐标和楼宇高亮", () => {
    const drawing = editor();
    const selected = buildingFromFeature(sourceBuilding as Feature)!;
    render(<FlightMap drawing={drawing} selectedBuilding={selected} />);
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.sourceOptions.get("context-buildings")).toEqual({
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    });
    const originalDrawing = map.sourceOptions.get("drawing");
    fireEvent.click(screen.getByRole("button", { name: "3D" }));
    expect(map.layoutCalls).toContainEqual([
      "context-buildings-3d",
      "visibility",
      "visible",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    act(() => map.handlers.get("style.load")?.());
    expect(map.layers.has("context-buildings-3d")).toBe(true);
    expect(map.sourceOptions.get("drawing")).toEqual(originalDrawing);
    expect(map.sourceOptions.get("selected-building")).toMatchObject({
      data: {
        features: [
          {
            geometry: { type: "Polygon", coordinates: [selected.outline] },
            properties: { height: 0 },
          },
        ],
      },
    });
    expect(map.layoutCalls).toContainEqual([
      "selected-building-extrusion",
      "visibility",
      "visible",
    ]);
    expect(map.paintCalls).toEqual([]);
    expect(map.fits).toHaveLength(0);
  });
  it("如实展示低缩放、当前无覆盖与数据错误，不把空覆盖当成功选楼宇", () => {
    render(<FlightMap drawing={editor()} />);
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    map.zoom = 11;
    act(() => map.handlers.get("idle")?.());
    expect(screen.getByRole("status").textContent).toContain("放大至街区");
    map.zoom = 17;
    act(() => map.handlers.get("idle")?.());
    expect(screen.getByRole("status").textContent).toBe("当前视野暂无楼宇轮廓");
    act(() =>
      map.handlers.get("error")?.({ sourceId: "context-buildings" } as never),
    );
    expect(screen.getByRole("status").textContent).toBe("楼宇数据暂不可用");
    act(() => map.handlers.get("idle")?.());
    expect(screen.getByRole("status").textContent).toBe("楼宇数据暂不可用");
  });
  it("侧栏定位请求等待地图就绪且每revision仅执行一次，普通marker选择不拉镜头", () => {
    const drawing = editor();
    const request = { index: 1, revision: 1 };
    const view = render(
      <FlightMap drawing={{ ...drawing, focusRequest: request }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "2D" }));
    const map = harness.instances[0];
    map.zoom = 12;
    expect(map.flyCalls).toEqual([]);
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls).toEqual([
      { center: [120.2, 30.3], zoom: 16, duration: 450 },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "航点 1 · 起点，可拖动调整" }),
    );
    view.rerender(
      <FlightMap
        drawing={{ ...drawing, selectedIndex: 0, focusRequest: request }}
      />,
    );
    expect(map.flyCalls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls).toHaveLength(1);
    map.zoom = 18;
    view.rerender(
      <FlightMap
        drawing={{ ...drawing, focusRequest: { index: 0, revision: 2 } }}
      />,
    );
    expect(map.flyCalls.at(-1)).toEqual({
      center: [120.1, 30.2],
      zoom: 18,
      duration: 450,
    });
    view.rerender(
      <FlightMap
        drawing={{ ...drawing, focusRequest: { index: 99, revision: 3 } }}
      />,
    );
    expect(map.flyCalls).toHaveLength(2);
  });
  it("多楼合并feature点击后仅高亮命中单体，不将整个片区按feature.id染色", () => {
    const onBuildingSelect = vi.fn();
    render(
      <FlightMap
        drawing={editor({ interaction: "inspect" })}
        onBuildingSelect={onBuildingSelect}
      />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    const first = [
      [120.1, 30.2],
      [120.2, 30.2],
      [120.2, 30.3],
      [120.1, 30.3],
      [120.1, 30.2],
    ];
    const second = first.map(([x, y]) => [x + 0.2, y + 0.2]);
    map.features = [
      {
        ...sourceBuilding,
        geometry: { type: "MultiPolygon", coordinates: [[first], [second]] },
      },
    ];
    clickMap(map);
    expect(onBuildingSelect).toHaveBeenCalledWith(
      expect.objectContaining({ outline: first, center: [120.15, 30.25] }),
    );
    expect(
      map.getSource("selected-building")?.setData,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        features: [
          expect.objectContaining({
            geometry: { type: "Polygon", coordinates: [first] },
            properties: { height: 70 },
          }),
        ],
      }),
    );
    expect(map.paintCalls).toEqual([]);
  });
});

describe("设备分类与区域视角", () => {
  it("通用DEVICE不遮蔽真实类型，各设备图层独立控制", () => {
    const objects = [
      {
        id: "typed-dock",
        name: "类型机巢",
        kind: "DEVICE",
        type: "DOCK",
        longitude: 120.1,
        latitude: 30.2,
      },
      {
        id: "typed-camera",
        name: "普通摄像机",
        kind: "DEVICE",
        type: "CAMERA",
        longitude: 120.2,
        latitude: 30.3,
      },
      {
        id: "typed-uav",
        name: "航空器",
        type: "UAV",
        longitude: 120.3,
        latitude: 30.4,
      },
    ];
    const onSelect = vi.fn();
    const view = render(
      <FlightMap
        objects={objects}
        onSelect={onSelect}
        layers={{ devices: false, equipment: false }}
      />,
    );
    act(() => harness.instances[0].handlers.get("style.load")?.());
    expect(screen.getByRole("button", { name: "类型机巢" }).title).toContain(
      "机巢",
    );
    expect(screen.queryByRole("button", { name: "普通摄像机" })).toBeNull();
    expect(screen.queryByRole("button", { name: "航空器" })).toBeNull();
    view.rerender(
      <FlightMap
        objects={objects}
        onSelect={onSelect}
        layers={{ sites: false, devices: false }}
      />,
    );
    expect(screen.getByRole("button", { name: "普通摄像机" }).title).toContain(
      "摄像机",
    );
    expect(screen.queryByRole("button", { name: "类型机巢" })).toBeNull();
  });

  it("区域定位只消费一次，轮询与切换底图不重放，空区域恢复杭州", () => {
    const request: AreaFocusRequest = {
      location: {
        bounds: [
          [120.1, 30.2],
          [120.3, 30.4],
        ],
      },
      revision: 1,
    };
    const view = render(<FlightMap areaFocusRequest={request} />);
    const map = harness.instances[0];
    expect(map.flyCalls).toHaveLength(0);
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls).toHaveLength(1);
    expect(map.flyCalls[0].center[0]).toBeCloseTo(120.2);
    view.rerender(
      <FlightMap
        areaFocusRequest={{ ...request }}
        objects={[{ id: "far", type: "UAV", longitude: 80, latitude: 40 }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "电子图" }));
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls).toHaveLength(1);
    view.rerender(
      <FlightMap areaFocusRequest={{ location: null, revision: 2 }} />,
    );
    expect(map.flyCalls.at(-1)).toMatchObject({
      center: [120.155, 30.27],
      zoom: 11.2,
    });
    expect(map.flyCalls).toHaveLength(2);
  });

  it("全国授权设备加载不触发全量视角适配", () => {
    render(
      <FlightMap
        objects={[{ id: "far", type: "UAV", longitude: 80, latitude: 40 }]}
      />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(map.flyCalls).toHaveLength(0);
    expect(map.fits).toHaveLength(0);
  });

  it("圆形保留完整范围但只显示圆心和半径控制点，拖动回传控制点索引", () => {
    const center: [number, number] = [120, 30];
    const points = airspaceShapePoints({
      type: "CIRCLE",
      center,
      radiusMeters: 500,
    }).map(([x, y]): [number, number] => [x, y]);
    const onMove = vi.fn();
    render(
      <FlightMap
        drawing={{
          mode: "AIRSPACE",
          points,
          controls: [
            { point: center, label: "圆心" },
            { point: points[16], label: "半径" },
          ],
          selectedIndex: 0,
          onSelect: vi.fn(),
          onMove,
        }}
      />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(
      screen.getByRole("button", { name: "圆心，可拖动调整" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "半径，可拖动调整" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "边界点 1，可拖动调整" }),
    ).toBeNull();
    expect(map.sourceOptions.get("drawing")).toMatchObject({
      data: {
        features: [
          {
            geometry: {
              type: "Polygon",
              coordinates: [[...points, points[0]]],
            },
          },
        ],
      },
    });
    const handle = harness.markers.find(
      (marker) => marker.options.element.textContent === "半径",
    )!;
    handle.point = [120.01, 30];
    act(() => handle.handlers.get("dragend")?.());
    expect(onMove).toHaveBeenCalledWith(1, [120.01, 30]);
  });

  it("空域统一边界点语义并显示内环，航线首末点不受影响", () => {
    const hole: [number, number][] = [
      [120.12, 30.22],
      [120.13, 30.22],
      [120.13, 30.23],
      [120.12, 30.22],
    ];
    render(
      <FlightMap
        drawing={{
          mode: "AIRSPACE",
          points: [
            [120.1, 30.2],
            [120.3, 30.2],
            [120.3, 30.4],
          ],
          innerRings: [hole],
          selectedIndex: 0,
          onSelect: vi.fn(),
          onMove: vi.fn(),
        }}
      />,
    );
    const map = harness.instances[0];
    act(() => map.handlers.get("style.load")?.());
    expect(
      screen.getByRole("button", { name: "边界点 1，可拖动调整" }).className,
    ).not.toContain("first");
    expect(
      screen.getByRole("button", { name: "边界点 3，可拖动调整" }).className,
    ).not.toContain("last");
    expect(screen.getByRole("button", { name: "范围总览" }).title).toBe(
      "查看全部边界点范围",
    );
    expect(map.sourceOptions.get("drawing")).toMatchObject({
      data: {
        features: [
          {
            geometry: {
              type: "Polygon",
              coordinates: [expect.any(Array), hole],
            },
          },
        ],
      },
    });
  });
});
