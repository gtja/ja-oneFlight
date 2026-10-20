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
import {
  MercatorCoordinate,
  type CustomRenderMethodInput,
  type Map as LibreMap,
} from "maplibre-gl";
import FlightSimulation3D, { AircraftFlightLayer } from "./FlightSimulation3D";
import { FLIGHT_CENTER, FLIGHT_LAYER_ID } from "./flightSimulationMath";
import {
  AircraftReportHistory,
  DemoAircraftReportProvider,
  DEFAULT_AIRCRAFT_DEFINITIONS,
  type AircraftPositionReport,
} from "./flightReports";

function fakeGL() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    FLOAT: 6,
    CULL_FACE: 7,
    DEPTH_TEST: 8,
    LEQUAL: 9,
    BLEND: 10,
    SRC_ALPHA: 11,
    ONE_MINUS_SRC_ALPHA: 12,
    ONE: 13,
    DYNAMIC_DRAW: 14,
    TRIANGLES: 15,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    createBuffer: vi.fn(() => ({})),
    getAttribLocation: vi.fn((_: unknown, name: string) =>
      name === "a_position" ? 0 : 1,
    ),
    deleteShader: vi.fn(),
    isProgram: vi.fn(() => true),
    useProgram: vi.fn(),
    bindBuffer: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    disableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    depthFunc: vi.fn(),
    blendFuncSeparate: vi.fn(),
    depthMask: vi.fn(),
    bufferData: vi.fn(),
    drawArrays: vi.fn(),
    deleteProgram: vi.fn(),
    deleteBuffer: vi.fn(),
  };
  return gl;
}

function projection() {
  const center = MercatorCoordinate.fromLngLat(FLIGHT_CENTER);
  return {
    defaultProjectionData: {
      mainMatrix: [
        35000,
        0,
        0,
        0,
        0,
        -20000,
        0,
        0,
        0,
        30000,
        0,
        0,
        -35000 * center.x,
        20000 * center.y,
        0,
        1,
      ],
    },
  } as unknown as CustomRenderMethodInput;
}

class FakeMap {
  gl = fakeGL();
  container = document.createElement("div");
  canvas = document.createElement("canvas");
  layers = new Map<string, AircraftFlightLayer>();
  handlers = new Map<
    string,
    Set<(event: { originalEvent?: unknown }) => void>
  >();
  flyTo = vi.fn();
  fitBounds = vi.fn();
  easeTo = vi.fn();
  queryTerrainElevation = vi.fn(() => 35);
  constructor() {
    Object.defineProperty(this.canvas, "clientWidth", { value: 1200 });
    Object.defineProperty(this.canvas, "clientHeight", { value: 700 });
    this.container.append(this.canvas);
    document.body.append(this.container);
  }
  getCanvas() {
    return this.canvas;
  }
  getContainer() {
    return this.container;
  }
  getTerrain() {
    return {};
  }
  getSource() {
    return {};
  }
  isSourceLoaded() {
    return true;
  }
  getLayer(id: string) {
    return this.layers.get(id);
  }
  addLayer(layer: AircraftFlightLayer) {
    this.layers.set(layer.id, layer);
    layer.onAdd(
      this as unknown as LibreMap,
      this.gl as unknown as WebGLRenderingContext,
    );
  }
  removeLayer(id: string) {
    this.layers.get(id)?.onRemove();
    this.layers.delete(id);
  }
  triggerRepaint() {
    this.layers.forEach((layer) =>
      layer.render(this.gl as unknown as WebGLRenderingContext, projection()),
    );
  }
  on(event: string, handler: (event: { originalEvent?: unknown }) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (event: { originalEvent?: unknown }) => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(
    event: string,
    data: { originalEvent?: unknown; businessObjectFocus?: boolean } = {
      originalEvent: new Event(event),
    },
  ) {
    this.handlers.get(event)?.forEach((callback) => callback(data));
  }
}

let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const originalMatchMedia = window.matchMedia;
vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
  frames.set(++frameId, callback);
  return frameId;
});
vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
function frame(timestamp: number) {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(timestamp));
  });
}
afterEach(() => {
  cleanup();
  frames.clear();
  document.body.innerHTML = "";
  Object.defineProperty(document, "hidden", {
    value: false,
    configurable: true,
  });
  Object.defineProperty(window, "matchMedia", {
    value: originalMatchMedia,
    configurable: true,
  });
});

describe("指挥大屏三维飞行图层", () => {
  const externalPoint = (
    second: number,
    extra: Partial<AircraftPositionReport> = {},
  ): AircraftPositionReport => ({
    deviceId: "external-1",
    timestamp: 1_750_000_000_000 + second * 1000,
    longitude: 120 + second * 0.0001,
    latitude: 30,
    altitudeMeters: 160,
    altitudeReference: "AGL",
    ...extra,
  });
  it("真实世界网格和已上报轨迹进入深度测试；四机空中与地面位置分离；释放GPU和标签", () => {
    const map = new FakeMap();
    const fail = vi.fn();
    const history = new AircraftReportHistory();
    history.ingest(new DemoAircraftReportProvider().initialReports(), 0);
    const layer = new AircraftFlightLayer({
      time: () => 12,
      selection: () => "patrol-01",
      select: vi.fn(),
      fail,
      tracks: () => history.snapshot(),
      definitions: DEFAULT_AIRCRAFT_DEFINITIONS,
    });
    map.addLayer(layer);
    map.triggerRepaint();
    const labels = [
      ...map.container.querySelectorAll<HTMLElement>(
        ".flight-simulation-aircraft",
      ),
    ];
    expect(labels).toHaveLength(4);
    expect(labels.every((label) => Number(label.dataset.height) >= 120)).toBe(
      true,
    );
    expect(
      labels.every(
        (label) =>
          Math.abs(Number(label.dataset.airY) - Number(label.dataset.groundY)) >
          10,
      ),
    ).toBe(true);
    expect(map.gl.drawArrays).toHaveBeenCalledTimes(2);
    expect(map.gl.depthMask.mock.calls.map(([value]) => value)).toEqual([
      false,
      true,
      true,
    ]);
    for (const call of map.gl.bufferData.mock.calls) {
      const vertices = call[1] as Float32Array;
      expect(vertices.length).toBeGreaterThan(100);
      expect(Array.from(vertices).every(Number.isFinite)).toBe(true);
    }
    expect(fail).not.toHaveBeenCalled();
    map.removeLayer(FLIGHT_LAYER_ID);
    expect(
      map.container.querySelector(".flight-simulation-overlay"),
    ).toBeNull();
    expect(map.gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(map.gl.deleteBuffer).toHaveBeenCalledTimes(1);
  });

  it("历史高度基准改变时断线，避免将AGL与AMSL不确定航段直接相连", () => {
    function geometry(mixed: boolean) {
      const map = new FakeMap(),
        history = new AircraftReportHistory();
      history.ingest(
        Array.from({ length: 4 }, (_, index) =>
          externalPoint(index, {
            longitude: 120.173 + index * 0.0002,
            latitude: 30.235,
            altitudeReference: mixed && index < 2 ? "AGL" : "AMSL",
          }),
        ),
        0,
      );
      const layer = new AircraftFlightLayer({
        time: () => 100,
        tracks: () => history.snapshot(),
        definitions: [
          { deviceId: "external-1", name: "外部飞机", kind: "multirotor" },
        ],
        selection: () => "external-1",
        select: vi.fn(),
        fail: vi.fn(),
      });
      map.addLayer(layer);
      map.triggerRepaint();
      const floats = (map.gl.bufferData.mock.calls[0][1] as Float32Array)
        .length;
      map.removeLayer(FLIGHT_LAYER_ID);
      return floats;
    }
    // A single omitted line segment is two triangles, six vertices of xyz + rgba.
    expect(geometry(false) - geometry(true)).toBe(6 * 7);
  });

  it("StrictMode、切底图、暂停、关闭重开和卸载不遗留图层或动画", () => {
    const map = new FakeMap();
    const props = {
      map: map as unknown as LibreMap,
      ready: true,
      styleEpoch: 1,
      threeD: true,
      onRequest3D: vi.fn(),
    };
    const view = render(
      <StrictMode>
        <FlightSimulation3D {...props} />
      </StrictMode>,
    );
    expect(map.layers.size).toBe(1);
    expect(
      map.container.querySelectorAll(".flight-simulation-overlay"),
    ).toHaveLength(1);
    frame(0);
    frame(1000);
    const controls = screen.getByTestId("flight-simulation");
    expect(Number(controls.dataset.seconds)).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "暂停飞行" }));
    expect(frames.size).toBe(0);
    view.rerender(
      <StrictMode>
        <FlightSimulation3D {...props} ready={false} />
      </StrictMode>,
    );
    expect(map.layers.size).toBe(0);
    view.rerender(
      <StrictMode>
        <FlightSimulation3D {...props} styleEpoch={2} />
      </StrictMode>,
    );
    expect(map.layers.size).toBe(1);
    expect(controls.dataset.paused).toBe("true");
    expect(Number(controls.dataset.seconds)).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "继续飞行" }));
    frame(100_000);
    frame(101_000);
    expect(Number(controls.dataset.seconds)).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "关闭飞行" }));
    expect(map.layers.size).toBe(0);
    expect(
      map.container.querySelector(".flight-simulation-aircraft"),
    ).toBeNull();
    expect(frames.size).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "开启飞行" }));
    expect(map.layers.size).toBe(1);
    expect(Number(controls.dataset.seconds)).toBe(0);
    expect(controls.dataset.paused).toBe("false");
    view.unmount();
    expect(map.layers.size).toBe(0);
    expect(frames.size).toBe(0);
    expect([...map.handlers.values()].every((handlers) => !handlers.size)).toBe(
      true,
    );
  });

  it("跟随受选机、手动地图操作和2D约束，页面隐藏时停止计时", () => {
    const map = new FakeMap();
    const props = {
      map: map as unknown as LibreMap,
      ready: true,
      styleEpoch: 1,
      threeD: true,
      onRequest3D: vi.fn(),
    };
    const view = render(<FlightSimulation3D {...props} />);
    const controls = screen.getByTestId("flight-simulation");
    frame(0);
    frame(1000);
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    expect(controls.dataset.following).toBe("patrol-01");
    act(() => map.emit("dragstart"));
    expect(controls.dataset.following).toBe("");
    fireEvent.click(screen.getByRole("combobox", { name: "选择航空器" }));
    fireEvent.click(screen.getByRole("option", { name: "城配 03 · 固定翼" }));
    fireEvent.click(screen.getByRole("button", { name: "跟随城配 03" }));
    expect(controls.dataset.following).toBe("cargo-03");
    view.rerender(<FlightSimulation3D {...props} threeD={false} />);
    expect(controls.dataset.following).toBe("");
    act(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(frames.size).toBe(0);
    act(() => {
      Object.defineProperty(document, "hidden", {
        value: false,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    frame(100_000);
    frame(101_000);
    expect(Number(controls.dataset.seconds)).toBe(2);
  });

  it("标签与工具栏选机同步，只在更换航空器时退出跟随，并给出操作反馈", () => {
    const map = new FakeMap();
    render(
      <FlightSimulation3D
        map={map as unknown as LibreMap}
        ready
        styleEpoch={1}
        threeD
        onRequest3D={vi.fn()}
      />,
    );
    const controls = screen.getByTestId("flight-simulation");
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    expect(screen.getByRole("status").textContent).toContain(
      "正在跟随 巡查 01",
    );
    fireEvent.click(screen.getByRole("button", { name: "选择巡查 01" }));
    expect(controls.dataset.following).toBe("patrol-01");
    fireEvent.click(screen.getByRole("button", { name: "选择城配 03" }));
    expect(controls.dataset.following).toBe("");
    expect(screen.getByRole("combobox").getAttribute("data-value")).toBe(
      "cargo-03",
    );
    expect(
      screen
        .getByRole("button", { name: "选择城配 03" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("已选 城配 03");
    fireEvent.click(screen.getByRole("button", { name: "跟随城配 03" }));
    act(() => map.emit("dragstart"));
    expect(screen.getByRole("status").textContent).toBe(
      "已退出跟随 · 可自由浏览地图",
    );
    fireEvent.click(screen.getByRole("button", { name: "暂停飞行" }));
    expect(screen.getByRole("status").textContent).toContain("画面已暂停");
    fireEvent.click(screen.getByRole("button", { name: "继续飞行" }));
    expect(screen.getByRole("status").textContent).toContain("画面已继续");
    fireEvent.click(screen.getByRole("button", { name: "飞行近览" }));
    expect(screen.getByRole("status").textContent).toContain("已恢复飞行近览");
    fireEvent.click(screen.getByRole("button", { name: "全市总览" }));
    expect(screen.getByRole("status").textContent).toContain("已恢复全市总览");
  });

  it("初始化和关闭重开保留2D，明确点击近览或跟随才请求三维视角", () => {
    const map = new FakeMap(),
      onRequest3D = vi.fn();
    render(
      <FlightSimulation3D
        map={map as unknown as LibreMap}
        ready
        styleEpoch={1}
        threeD={false}
        onRequest3D={onRequest3D}
      />,
    );
    expect(onRequest3D).not.toHaveBeenCalled();
    expect(map.fitBounds.mock.calls.at(-1)?.[1].pitch).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "关闭飞行" }));
    fireEvent.click(screen.getByRole("button", { name: "开启飞行" }));
    expect(onRequest3D).not.toHaveBeenCalled();
    expect(map.fitBounds.mock.calls.at(-1)?.[1].pitch).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "飞行近览" }));
    expect(onRequest3D).toHaveBeenCalledTimes(1);
    expect(map.fitBounds.mock.calls.at(-1)?.[1].pitch).toBe(60);
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    expect(onRequest3D).toHaveBeenCalledTimes(2);
  });

  it("减少动态效果设置下镜头立即定位，保留上报驱动的跟随", () => {
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({ matches: true })),
      configurable: true,
    });
    const map = new FakeMap();
    render(
      <FlightSimulation3D
        map={map as unknown as LibreMap}
        ready
        styleEpoch={1}
        threeD
        onRequest3D={vi.fn()}
      />,
    );
    expect(map.fitBounds.mock.calls.at(-1)?.[1].duration).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    expect(map.flyTo.mock.calls.at(-1)?.[0].duration).toBe(0);
    frame(0);
    frame(1000);
    expect(map.easeTo.mock.calls.at(-1)?.[0].duration).toBe(0);
    expect(screen.getByTestId("flight-simulation").dataset.following).toBe(
      "patrol-01",
    );
    fireEvent.click(screen.getByRole("button", { name: "全市总览" }));
    expect(map.fitBounds.mock.calls.at(-1)?.[1].duration).toBe(0);
  });

  it("跟随先完成近景过渡，再开始按上报更新镜头，避免首帧打断拉近", () => {
    const map = new FakeMap();
    render(
      <FlightSimulation3D
        map={map as unknown as LibreMap}
        ready
        styleEpoch={1}
        threeD
        onRequest3D={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    expect(map.flyTo.mock.calls.at(-1)?.[0].duration).toBe(650);
    frame(0);
    frame(500);
    expect(map.easeTo).not.toHaveBeenCalled();
    frame(700);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    act(() => map.emit("dragstart"));
    frame(1000);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });

  it("业务对象定位退出飞行跟随并清除待执行镜头，普通程序镜头不误触发", () => {
    const map = new FakeMap();
    render(
      <FlightSimulation3D
        map={map as unknown as LibreMap}
        ready
        styleEpoch={1}
        threeD
        onRequest3D={vi.fn()}
      />,
    );
    const controls = screen.getByTestId("flight-simulation");
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    act(() => map.emit("movestart", {}));
    expect(controls.dataset.following).toBe("patrol-01");
    act(() => map.emit("movestart", { businessObjectFocus: true }));
    expect(controls.dataset.following).toBe("");
    expect(screen.getByRole("status").textContent).toBe(
      "已定位业务对象 · 退出飞行跟随",
    );
    frame(0);
    frame(1000);
    expect(map.easeTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "跟随巡查 01" }));
    frame(1100);
    frame(1800);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
    act(() => map.emit("movestart", { businessObjectFocus: true }));
    frame(2100);
    expect(map.easeTo).toHaveBeenCalledTimes(1);
  });

  it("外部空批次不启动demo；设备按报告生成，断流与空增量批次保留末点和历史", () => {
    const map = new FakeMap(),
      props = {
        map: map as unknown as LibreMap,
        ready: true,
        styleEpoch: 1,
        threeD: true,
        onRequest3D: vi.fn(),
      };
    const view = render(<FlightSimulation3D {...props} reports={[]} />);
    expect(
      map.container.querySelectorAll(".flight-simulation-aircraft"),
    ).toHaveLength(0);
    frame(0);
    frame(1000);
    expect(screen.getByTestId("flight-simulation").dataset.reportCount).toBe(
      "0",
    );
    view.rerender(
      <FlightSimulation3D
        {...props}
        reports={[externalPoint(0), externalPoint(1)]}
      />,
    );
    frame(2000);
    const label = map.container.querySelector<HTMLElement>(
      ".flight-simulation-aircraft",
    )!;
    expect(label.dataset.aircraftId).toBe("external-1");
    expect(label.dataset.kind).toBe("multirotor");
    expect(label.dataset.reportCount).toBe("2");
    expect(Number(label.dataset.lng)).toBe(120.0001);
    frame(6000);
    expect(Number(label.dataset.lng)).toBe(120.0001);
    view.rerender(<FlightSimulation3D {...props} reports={[]} />);
    expect(label.dataset.reportCount).toBe("2");
    expect(Number(label.dataset.lng)).toBe(120.0001);
    fireEvent.click(screen.getByRole("button", { name: "关闭飞行" }));
    fireEvent.click(screen.getByRole("button", { name: "开启飞行" }));
    expect(
      map.container.querySelector<HTMLElement>(".flight-simulation-aircraft")!
        .dataset.reportCount,
    ).toBe("2");
  });

  it("暂停时接收外部点但冻结显示，继续后停在最新有效报告；streamKey清空并重定位同设备", () => {
    const map = new FakeMap(),
      props = {
        map: map as unknown as LibreMap,
        ready: true,
        styleEpoch: 1,
        threeD: true,
        onRequest3D: vi.fn(),
      };
    const view = render(
      <FlightSimulation3D
        {...props}
        streamKey="a"
        reports={[externalPoint(0)]}
      />,
    );
    frame(0);
    frame(1000);
    fireEvent.click(screen.getByRole("button", { name: "暂停飞行" }));
    view.rerender(
      <FlightSimulation3D
        {...props}
        streamKey="a"
        reports={[externalPoint(1)]}
      />,
    );
    const controls = screen.getByTestId("flight-simulation");
    expect(controls.dataset.reportCount).toBe("1");
    expect(controls.dataset.receivedReportCount).toBe("2");
    expect(
      map.container.querySelector<HTMLElement>(".flight-simulation-aircraft")!
        .dataset.latestReportTimestamp,
    ).toBe(String(externalPoint(0).timestamp));
    fireEvent.click(screen.getByRole("button", { name: "继续飞行" }));
    frame(10000);
    frame(11000);
    expect(
      Number(
        map.container.querySelector<HTMLElement>(".flight-simulation-aircraft")!
          .dataset.lng,
      ),
    ).toBe(120.0001);
    view.rerender(
      <FlightSimulation3D
        {...props}
        streamKey="b"
        reports={[externalPoint(2, { longitude: 110, latitude: 25 })]}
      />,
    );
    const label = map.container.querySelector<HTMLElement>(
      ".flight-simulation-aircraft",
    )!;
    expect(label.dataset.reportCount).toBe("1");
    expect(label.dataset.firstReportTimestamp).toBe(
      String(externalPoint(2).timestamp),
    );
    expect(map.flyTo.mock.calls.at(-1)?.[0].center).toEqual([110, 25]);
    expect(Number(label.dataset.lng)).toBe(110);
  });
});
