// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MercatorCoordinate } from "maplibre-gl";
import {
  invertRoutePosition,
  projectRoutePosition,
  resolveRouteElevation,
  routeHeight,
  routeMesh,
  routeLabelVisibility,
  visibleRouteSegment,
  ElevatedRouteLayer,
} from "./elevatedRoute";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
describe("真实高度和投影", () => {
  it("0米为合法离地高度；缺省100米；真实地形与AGL相加且不混用源Z", () => {
    expect(routeHeight(0)).toBe(0);
    expect(routeHeight(undefined)).toBe(100);
    expect(routeHeight(NaN)).toBe(100);
    expect(resolveRouteElevation(76, 120)).toEqual({
      ground: 76,
      air: 196,
      known: true,
    });
    expect(resolveRouteElevation(-12, 0)).toEqual({
      ground: -12,
      air: -12,
      known: true,
    });
    expect(resolveRouteElevation(null, 100)).toEqual({
      ground: 0,
      air: 100,
      known: false,
    });
  });
  it("高度先转换真实Mercator Z，再经相机矩阵投影，平面/倾斜视角不使用屏幕抬高", () => {
    const ground = MercatorCoordinate.fromLngLat([120.1, 30.2], 25);
    const air = MercatorCoordinate.fromLngLat([120.1, 30.2], 125);
    expect(air.x).toBe(ground.x);
    expect(air.y).toBe(ground.y);
    expect(air.z - ground.z).toBeCloseTo(
      100 * ground.meterInMercatorCoordinateUnits(),
      12,
    );
    const topAir = projectRoutePosition(identity, air)!;
    const topGround = projectRoutePosition(identity, ground)!;
    expect(topAir.x).toBe(topGround.x);
    expect(topAir.y).toBe(topGround.y);
    const pitched = [...identity];
    pitched[9] = 12000;
    const pitchedGround = projectRoutePosition(pitched, ground)!;
    const pitchedAir = projectRoutePosition(pitched, air)!;
    expect(pitchedAir.y - pitchedGround.y).toBeCloseTo(
      (air.z - ground.z) * 12000,
      10,
    );
    const zoomed = [...pitched];
    zoomed[9] *= 2;
    expect(
      projectRoutePosition(zoomed, air)!.y -
        projectRoutePosition(zoomed, ground)!.y,
    ).toBeCloseTo((pitchedAir.y - pitchedGround.y) * 2, 10);
  });
  it("透视裁剪防止相机背后或无效坐标制造无限大图元", () => {
    const matrix = [...identity];
    matrix[15] = -1;
    expect(projectRoutePosition(matrix, { x: 1, y: 1, z: 1 })).toBeNull();
    expect(projectRoutePosition(identity, { x: NaN, y: 0, z: 0 })).toBeNull();
    expect(projectRoutePosition(identity, { x: 0, y: 0, z: -2 })).toBeNull();
  });
});
describe("空中航段、垂线和地面脚点", () => {
  it("辅助幕帘和位置投影可独立关闭，空中航线和真实高度始终保留", () => {
    const air = [
        { x: -0.3, y: 0.4, z: 0.2 },
        { x: 0.3, y: 0.5, z: 0.3 },
      ],
      ground = [
        { x: -0.3, y: -0.4, z: 0.8 },
        { x: 0.3, y: -0.3, z: 0.9 },
      ];
    const all = routeMesh(air, ground, 1200, 800, null),
      noCurtain = routeMesh(air, ground, 1200, 800, null, {
        showCurtain: false,
      }),
      minimal = routeMesh(air, ground, 1200, 800, null, {
        showCurtain: false,
        showGroundProjection: false,
      });
    expect(all.length).toBeGreaterThan(noCurtain.length);
    expect(noCurtain.length).toBeGreaterThan(minimal.length);
    for (const mesh of [all, noCurtain, minimal]) {
      const depths = Array.from(mesh).filter((_, index) => index % 7 === 2);
      expect(Math.min(...depths)).toBeCloseTo(0.2);
      expect(Math.max(...depths)).toBeCloseTo(0.9);
    }
  });
  it("从很远处跨越视口的垂线与地面辅助线按可见范围生成，深度裁剪且不放大实际高度", () => {
    const extreme = routeMesh(
      [
        { x: -1e9, y: 1e9, z: -1e9 },
        { x: 0.5, y: 1e9, z: 0.2 },
      ],
      [
        { x: 1e9, y: -1e9, z: 1e9 },
        { x: 0.5, y: -1e9, z: 0.8 },
      ],
      1200,
      800,
      null,
    );
    expect(extreme.length).toBeGreaterThan(0);
    expect(extreme.length).toBeLessThan(100000);
    expect(Array.from(extreme).every(Number.isFinite)).toBe(true);
    const depths = Array.from(extreme).filter((_, index) => index % 7 === 2);
    expect(Math.min(...depths)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...depths)).toBeLessThanOrEqual(1);
    expect(routeMesh([], [], 0, 800, null)).toHaveLength(0);
    expect(routeMesh([], [], 1200, NaN, null)).toHaveLength(0);
  });
  it("mesh包含真正不同深度的地面/空中坐标，绿色实线和白虚线，0米不产生NaN", () => {
    const air = [
      { x: 0, y: 0.5, z: 0.2 },
      { x: 0.4, y: 0.6, z: 0.3 },
    ];
    const ground = [
      { x: 0, y: 0, z: 0.8 },
      { x: 0.4, y: 0.1, z: 0.9 },
    ];
    const mesh = routeMesh(air, ground, 1200, 800, 0);
    expect(mesh.length % 21).toBe(0);
    expect(Array.from(mesh).every(Number.isFinite)).toBe(true);
    const depths = Array.from(mesh).filter((_, index) => index % 7 === 2);
    expect(Math.min(...depths)).toBeCloseTo(0.2);
    expect(Math.max(...depths)).toBeCloseTo(0.9);
    const zero = routeMesh(ground, ground, 1200, 800, null);
    expect(Array.from(zero).every(Number.isFinite)).toBe(true);
    expect(routeMesh([], [], 1200, 800, null).length).toBe(0);
  });
  it("带高度反投影拖动修正透视，不能将鼠标贴地unproject误作空中航点", () => {
    const project = ([lng, lat]: [number, number]) => ({
      x: 20000 * lng + 4000 * lat + 36,
      y: -6000 * lng + 30000 * lat - 83,
    });
    const expected: [number, number] = [120.106, 30.209];
    const result = invertRoutePosition(
      [120.1, 30.2],
      project(expected),
      project,
    )!;
    expect(result[0]).toBeCloseTo(expected[0], 7);
    expect(result[1]).toBeCloseTo(expected[1], 7);
    expect(
      invertRoutePosition([120, 30], { x: 1, y: 1 }, () => null),
    ).toBeNull();
    expect(
      invertRoutePosition([120, 30], { x: 1, y: 1 }, () => ({ x: 0, y: 0 })),
    ).toBeNull();
  });
});

describe("航线视口裁剪与标签布局", () => {
  it("完全离屏段忽略，跨屏段保留插值深度，近远裁面外的段忽略", () => {
    expect(
      visibleRouteSegment({ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }),
    ).toEqual([0.25, 0.75]);
    expect(
      visibleRouteSegment({ x: 2, y: 0, z: 0 }, { x: 3, y: 0.5, z: 0.5 }),
    ).toBeNull();
    expect(
      visibleRouteSegment({ x: 0, y: 0, z: 2 }, { x: 0.1, y: 0.1, z: 3 }),
    ).toBeNull();
    expect(
      visibleRouteSegment({ x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 2 }),
    ).toEqual([0.25, 0.75]);
    expect(
      visibleRouteSegment({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
    ).toBeNull();
  });
  it("重叠时优先显示选中点高度，隐藏其他标签不改变航点位置；离屏标签不占位", () => {
    const labels = [
      { x: 0, y: 0, width: 79, height: 28, visible: true },
      { x: 82, y: 0, width: 79, height: 28, visible: true },
      { x: 200, y: 0, width: 79, height: 28, visible: false },
      { x: 200, y: 0, width: 79, height: 28, visible: true },
    ];
    expect(routeLabelVisibility(labels, 1)).toEqual([false, true, false, true]);
    expect(routeLabelVisibility(labels, null)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(labels[0].x).toBe(0);
  });
  it("高度标签开关不修改高度和交互，未知地形不会被标签写成绝对高程", () => {
    const container = document.createElement("div"),
      map = {
        getContainer: () => container,
        on: vi.fn(),
        off: vi.fn(),
        triggerRepaint: vi.fn(),
      };
    const onSelect = vi.fn(),
      drawing = {
        points: [[120.1, 30.2]] as [number, number][],
        heightMeters: [120.5],
        selectedIndex: 0,
        onSelect,
        onMove: vi.fn(),
      };
    const layer = new ElevatedRouteLayer(drawing);
    layer.onAdd(map as never, {} as never);
    const button = container.querySelector<HTMLButtonElement>(
      ".route-elevated-waypoint",
    )!;
    expect(button.dataset.heightMeters).toBe("120.5");
    expect(button.getAttribute("aria-label")).toContain("离地 120.5 米");
    expect(button.querySelector(".route-elevated-height")?.textContent).toBe(
      "120.5 m",
    );
    layer.setDrawing({ ...drawing, showHeightLabels: false });
    expect(
      (button.querySelector(".route-elevated-height") as HTMLElement).hidden,
    ).toBe(true);
    expect(button.dataset.heightMeters).toBe("120.5");
    button.click();
    expect(onSelect).toHaveBeenCalledWith(0);
    layer.onRemove();
    expect(container.childElementCount).toBe(0);
  });
});
