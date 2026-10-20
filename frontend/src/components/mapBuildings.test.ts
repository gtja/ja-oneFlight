import { describe, expect, it } from "vitest";
import { buildingFromFeature } from "./mapBuildings";
import type { Feature, Polygon } from "geojson";
const feature: Feature<Polygon> = {
  type: "Feature",
  id: "13673454710",
  properties: { render_height: 70, render_min_height: 0 },
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
describe("真实楼宇来源属性", () => {
  it("不把默认或楼层推算的render_height写成测量高度，不臆造名称", () => {
    const value = buildingFromFeature(feature)!;
    expect(value.id).toMatch(/^13673454710:polygon:[a-f0-9]{8}$/);
    expect(value.heightMeters).toBeNull();
    expect(value.name).toBe("未命名楼宇 · #13673454710");
    expect(value.center[0]).toBeCloseTo(120.15);
    expect(value.center[1]).toBeCloseTo(30.3);
    expect(value.source).toBe("OpenFreeMap / OpenStreetMap");
  });
  it("仅保留存在且有效的源高度和名称，缺失高度保持未知", () => {
    expect(
      buildingFromFeature({
        ...feature,
        properties: { height: "42.8", "name:zh": "来源楼宇名" },
      }),
    ).toMatchObject({ name: "来源楼宇名", heightMeters: 42.8 });
    for (const height of [undefined, null, "", "unknown", -1])
      expect(
        buildingFromFeature({ ...feature, properties: { height } })
          ?.heightMeters,
      ).toBeNull();
  });
  it("不接受空轮廓，缺源ID时用实际轮廓位置形成标识", () => {
    expect(
      buildingFromFeature({
        ...feature,
        geometry: { type: "Polygon", coordinates: [] },
      }),
    ).toBeNull();
    expect(buildingFromFeature({ ...feature, id: undefined })?.id).toMatch(
      /^outline:polygon:[a-f0-9]{8}$/,
    );
  });
  it("MultiPolygon按命中楼宇单体保存轮廓中心，未命中时取最近外环", () => {
    const first = [
      [120.1, 30.2],
      [120.11, 30.2],
      [120.11, 30.21],
      [120.1, 30.21],
      [120.1, 30.2],
    ];
    const second = first.map(([x, y]) => [x + 0.1, y + 0.1]);
    const multi: Feature = {
      ...feature,
      geometry: { type: "MultiPolygon", coordinates: [[first], [second]] },
    };
    const a = buildingFromFeature(multi, [120.105, 30.205])!;
    const b = buildingFromFeature(multi, [120.205, 30.305])!;
    expect(a.outline).toEqual(first);
    expect(b.outline).toEqual(second);
    expect(a.id).not.toBe(b.id);
    expect(a.center[0]).toBeCloseTo(120.105);
    expect(a.center[1]).toBeCloseTo(30.205);
    expect(b.center[0]).toBeCloseTo(120.205);
    expect(b.center[1]).toBeCloseTo(30.305);
    expect(buildingFromFeature(multi, [120.22, 30.31])?.id).toBe(b.id);
  });
  it("单体ID不因MultiPolygon排序、外环起点或方向变化而变化", () => {
    const ring = [
      [120.1, 30.2],
      [120.11, 30.2],
      [120.11, 30.21],
      [120.1, 30.21],
    ];
    const shifted = [...ring.slice(2), ...ring.slice(0, 2)].reverse();
    const a = buildingFromFeature({
      ...feature,
      geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
    });
    const b = buildingFromFeature(
      {
        ...feature,
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [[...shifted, shifted[0]]],
            [
              [
                [121, 31],
                [121.1, 31],
                [121, 31.1],
                [121, 31],
              ],
            ],
          ],
        },
      },
      [120.105, 30.205],
    );
    expect(a?.id).toBe(b?.id);
  });
});
