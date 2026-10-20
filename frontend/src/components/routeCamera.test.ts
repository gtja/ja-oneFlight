import { describe, expect, it } from "vitest";
import { routeCloseupCamera, type RoutePoint } from "./routeCamera";

describe("航线局部真实高度相机", () => {
  const cityRoute: RoutePoint[] = [
    [120.1, 30.2],
    [120.6, 30.5],
    [120.8, 30.1],
  ];
  it("数十公里路线聚焦选中航点不缩成城市总览，100m有街区级清晰度", () => {
    const camera = routeCloseupCamera(cityRoute, [100, 100, 100], 1)!;
    expect(camera.center).toEqual(cityRoute[1]);
    expect(camera.zoom).toBe(17.2);
    expect(camera.pitch).toBe(60);
    expect(camera.offset).toEqual([0, 102]);
    expect(camera.bearing).toBeGreaterThanOrEqual(-180);
    expect(camera.bearing).toBeLessThan(180);
  });
  it("无选择/失效选择回到起点，空航线无相机请求", () => {
    expect(routeCloseupCamera(cityRoute)?.center).toEqual(cityRoute[0]);
    expect(routeCloseupCamera(cityRoute, [], 99)?.center).toEqual(cityRoute[0]);
    expect(routeCloseupCamera([])).toBeNull();
  });
  it("短航线涵盖相邻街区航点，远距离邻点不会拉走局部中心", () => {
    const points: RoutePoint[] = [
      [120.1, 30.2],
      [120.101, 30.2],
      [120.6, 30.5],
    ];
    const camera = routeCloseupCamera(points, [100, 100, 100], 1)!;
    expect(camera.center[0]).toBeCloseTo(120.1005);
    expect(camera.center[1]).toBeCloseTo(30.2);
    expect(camera.zoom).toBeGreaterThanOrEqual(17);
  });
  it("小窗口仍为100m保留高度空间，高航点降低相机zoom并且不改实际高度", () => {
    const points: RoutePoint[] = [[120.1, 30.2]];
    const heights = [100];
    const small = routeCloseupCamera(points, heights, 0, {
      width: 600,
      height: 377,
    })!;
    expect(small.zoom).toBeGreaterThanOrEqual(16.5);
    expect(small.zoom).toBeLessThan(17.2);
    expect(small.offset).toEqual([0, 121]);
    const tall = routeCloseupCamera(points, [600], 0)!;
    expect(tall.zoom).toBeLessThan(16);
    expect(tall.offset[1]).toBeGreaterThan(0);
    expect(heights).toEqual([100]);
    expect(points).toEqual([[120.1, 30.2]]);
  });
});
