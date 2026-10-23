import { describe, expect, it } from "vitest";
import {
  airspaceShapeHandles,
  airspaceShapePoints,
  inferAirspaceShape,
  moveAirspaceShape,
  sanitizeAirspaceShape,
  type AirspaceShape,
} from "./airspaceShapes";
import type { GeometryPosition } from "./geometry";

const circle: AirspaceShape = {
  type: "CIRCLE",
  center: [120.15, 30.25],
  radiusMeters: 1000,
};
const rectangle: AirspaceShape = {
  type: "RECTANGLE",
  west: 120,
  south: 30,
  east: 120.1,
  north: 30.1,
};

function distance(first: readonly number[], second: readonly number[]): number {
  const radians = Math.PI / 180;
  const latitude = (second[1] - first[1]) * radians;
  const longitude = (second[0] - first[0]) * radians;
  const arc =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(first[1] * radians) *
      Math.cos(second[1] * radians) *
      Math.sin(longitude / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(arc));
}

function sourceCircle(): GeometryPosition[] {
  const points = airspaceShapePoints(circle).filter(
    (_, index) => index % 2 === 0,
  );
  const rotated = [...points.slice(5), ...points.slice(0, 5)].reverse();
  return rotated.map((point, index) => [...point, 70 + index, 1000 + index]);
}

describe("空域规则图形校验", () => {
  it("读取已知图形且不保留无关字段或共享可变圆心", () => {
    const raw = { ...circle, extra: "source" };
    const normalized = sanitizeAirspaceShape(raw);
    expect(normalized).toEqual(circle);
    if (normalized?.type !== "CIRCLE" || circle.type !== "CIRCLE")
      throw new Error("expected circle");
    expect(normalized.center).not.toBe(circle.center);
    expect(sanitizeAirspaceShape(rectangle)).toEqual(rectangle);
  });

  it.each([
    null,
    {},
    { type: "UNKNOWN" },
    { ...circle, radiusMeters: 0 },
    { ...circle, radiusMeters: -100 },
    { ...circle, radiusMeters: Infinity },
    { ...circle, radiusMeters: "1000" },
    { ...circle, center: [NaN, 30] },
    { ...circle, center: [181, 30] },
    { ...circle, center: [120, 91] },
    { ...circle, center: [179.999, 30] },
    { ...circle, center: [-179.999, 30] },
    { ...circle, center: [120, 89.999] },
    { ...circle, center: [120, -89.999] },
    { ...rectangle, west: 121 },
    { ...rectangle, north: 30 },
    { ...rectangle, east: Infinity },
    { ...rectangle, south: -91 },
  ])("拒绝无效或跨极、日期变更线的图形：%j", (raw) => {
    expect(sanitizeAirspaceShape(raw)).toBeUndefined();
    expect(airspaceShapePoints(raw as AirspaceShape)).toEqual([]);
    expect(airspaceShapeHandles(raw as AirspaceShape)).toEqual([]);
  });
});

describe("已有空域图形识别", () => {
  it("小范围椭圆也不能因绝对误差较小被识别为圆", () => {
    const points = airspaceShapePoints({ ...circle, radiusMeters: 0.1 }).map(
      (point): GeometryPosition => [
        circle.center[0] + (point[0] - circle.center[0]) * 1.5,
        point[1],
      ],
    );
    expect(inferAirspaceShape(points)).toBeUndefined();
  });

  it("识别球面圆，支持闭环及高纬位置且不更改输入", () => {
    for (const latitude of [0, 30.25, 80, -70]) {
      const shape: AirspaceShape = {
        type: "CIRCLE",
        center: [120.15, latitude],
        radiusMeters: 20_000,
      };
      const points = airspaceShapePoints(shape);
      const closed = [...points, [...points[0]] as GeometryPosition];
      const original = structuredClone(closed);
      const inferred = inferAirspaceShape(closed);
      expect(inferred?.type).toBe("CIRCLE");
      if (inferred?.type !== "CIRCLE") throw new Error("expected circle");
      expect(inferred.center[0]).toBeCloseTo(shape.center[0], 7);
      expect(inferred.center[1]).toBeCloseTo(latitude, 7);
      expect(inferred.radiusMeters).toBeCloseTo(shape.radiusMeters, 4);
      expect(closed).toEqual(original);
    }
  });

  it("识别轴对齐矩形并保留原点序和附加维度", () => {
    const points: GeometryPosition[] = [
      [120.1, 30.1, 70, 1],
      [120.1, 30, 80, 2],
      [120, 30, 90, 3],
      [120, 30.1, 100, 4],
    ];
    expect(inferAirspaceShape(points)).toEqual(rectangle);
    expect(points[0]).toEqual([120.1, 30.1, 70, 1]);
  });

  it("不把普通多边形、椭圆、缺失大段的圆弧或乱序顶点识别为圆", () => {
    const points = airspaceShapePoints(circle);
    const irregular = points.map((point, index): GeometryPosition =>
      index === 10 ? [point[0] + 0.001, point[1]] : [...point],
    );
    const ellipse = points.map((point): GeometryPosition => [
      120.15 + (point[0] - 120.15) * 1.2,
      point[1],
    ]);
    const shuffled = [...points];
    [shuffled[5], shuffled[6]] = [shuffled[6], shuffled[5]];
    for (const invalid of [
      points.slice(0, 15),
      points.slice(0, 32),
      irregular,
      ellipse,
      shuffled,
      [...points, ...points],
      [
        [120, 30],
        [120.1, 30],
        [120.2, 30.1],
        [120, 30.1],
      ],
      [
        [120, 30],
        [120.1, 30.1],
        [120.1, 30],
        [120, 30.1],
      ],
      [
        [120, 30],
        [Infinity, 30],
        [120.1, 30.1],
        [120, 30.1],
      ],
    ])
      expect(inferAirspaceShape(invalid as GeometryPosition[])).toBeUndefined();
  });
});

describe("空域规则图形编辑", () => {
  it("新圆生成64个WGS84球面点，所有点都在指定米制半径上", () => {
    const points = airspaceShapePoints(circle);
    expect(points).toHaveLength(64);
    for (const point of points) {
      expect(point).toHaveLength(2);
      expect(distance([120.15, 30.25], point)).toBeCloseTo(1000, 6);
    }
    expect(points[0]).not.toEqual(points.at(-1));
  });

  it("移动圆心或半径时保留现有顶点数、方向、起点方位及每点来源维度", () => {
    const original = sourceCircle();
    const snapshot = structuredClone(original);
    const inferred = inferAirspaceShape(original);
    expect(inferred?.type).toBe("CIRCLE");
    if (inferred?.type !== "CIRCLE") throw new Error("expected circle");
    const moved = moveAirspaceShape(inferred, 0, [121, 31]);
    expect(moved).toEqual({ ...inferred, center: [121, 31] });
    if (!moved) throw new Error("expected moved circle");
    const points = airspaceShapePoints(moved, original);
    expect(points).toHaveLength(32);
    for (let index = 0; index < points.length; index += 1) {
      expect(points[index].slice(2)).toEqual(original[index].slice(2));
      expect(distance([121, 31], points[index])).toBeCloseTo(1000, 4);
    }
    // A no-op edit also preserves the original angular order and start bearing.
    const unchanged = airspaceShapePoints(inferred, original);
    unchanged.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(original[index][0], 7);
      expect(point[1]).toBeCloseTo(original[index][1], 7);
    });
    const handles = airspaceShapeHandles(moved);
    expect(handles[0]).toEqual([121, 31]);
    expect(handles[1][0]).toBeGreaterThan(121);
    expect(distance(handles[0], handles[1])).toBeCloseTo(1000, 4);
    const expanded = moveAirspaceShape(moved, 1, [121.02, 31]);
    expect(expanded?.type).toBe("CIRCLE");
    if (expanded?.type !== "CIRCLE")
      throw new Error("expected expanded circle");
    expect(expanded.radiusMeters).toBeCloseTo(
      distance([121, 31], [121.02, 31]),
      6,
    );
    expect(original).toEqual(snapshot);
  });

  it("矩形通过两个对角编辑，允许交叉并保留四角原序和来源维度", () => {
    const original: GeometryPosition[] = [
      [120.1, 30.1, 70],
      [120.1, 30, 80],
      [120, 30, 90],
      [120, 30.1, 100],
    ];
    const moved = moveAirspaceShape(rectangle, 0, [120.2, 30.2]);
    expect(moved).toEqual({
      type: "RECTANGLE",
      west: 120.1,
      south: 30.1,
      east: 120.2,
      north: 30.2,
    });
    if (!moved) throw new Error("expected rectangle");
    expect(airspaceShapePoints(moved, [...original, original[0]])).toEqual([
      [120.2, 30.2, 70],
      [120.2, 30.1, 80],
      [120.1, 30.1, 90],
      [120.1, 30.2, 100],
    ]);
    expect(airspaceShapeHandles(moved)).toEqual([
      [120.1, 30.1],
      [120.2, 30.2],
    ]);
    expect(airspaceShapePoints(rectangle)).toEqual([
      [120, 30],
      [120.1, 30],
      [120.1, 30.1],
      [120, 30.1],
    ]);
  });

  it("非法拖动、退化图形与非法来源点保持失败，切换形状使用默认点集", () => {
    expect(moveAirspaceShape(circle, 2, [120, 30])).toBeUndefined();
    expect(moveAirspaceShape(circle, 1, [120.15, 30.25])).toBeUndefined();
    expect(moveAirspaceShape(circle, 0, [179.999, 30])).toBeUndefined();
    expect(moveAirspaceShape(rectangle, 1, [120, 30])).toBeUndefined();
    expect(moveAirspaceShape(rectangle, 0, [NaN, 30])).toBeUndefined();
    expect(airspaceShapePoints(circle, [[120, NaN]])).toEqual([]);
    expect(
      airspaceShapePoints(circle, airspaceShapePoints(rectangle)),
    ).toHaveLength(64);
    expect(airspaceShapePoints(rectangle, sourceCircle())).toHaveLength(4);
  });
});
