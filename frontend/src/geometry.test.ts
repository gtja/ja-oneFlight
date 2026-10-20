import { describe, expect, it } from "vitest";
import {
  drawGeometry,
  ensureRouteFlightProfile,
  geometryPoints,
  geometryPositions,
  removeGeometryAssociation,
  removeGeometryPoint,
  resizeRouteFlightProfile,
  routeLengthMeters,
  sanitizeGeometryContext,
  setRouteFlightHeight,
  setRouteWaypointHeight,
  isRouteHeightMeters,
  updateGeometryPoint,
  type GeometryBuildingAssociation,
  type GeometryPosition,
} from "./geometry";

const source = {
  type: "LineString",
  coordinates: [
    [120.123456789, 30.987654321, 82.125],
    [120.124, 30.988, 91.375],
  ],
};
const building = (
  waypointIndex: number,
  id = `building-${waypointIndex}`,
): GeometryBuildingAssociation => ({
  waypointIndex,
  id,
  name: "巡检楼宇",
  heightMeters: null,
  center: [120.123, 30.987],
  source: "openfreemap",
});

describe("本地航线离地规划高度", () => {
  it("旧航线先生成独立100米AGL草稿，来源Z和楼宇轮廓保持原样", () => {
    const outline: [number, number][] = [
      [120, 30],
      [120.001, 30],
      [120.001, 30.001],
      [120, 30],
    ];
    const original = { version: 1, buildings: [{ ...building(0), outline }] };
    const next = ensureRouteFlightProfile(original, source.coordinates.length);
    expect(next.flightProfile).toEqual({
      reference: "AGL",
      defaultHeightMeters: 100,
      waypointHeightsMeters: [100, 100],
    });
    expect(next.buildings[0].outline).toEqual(outline);
    expect(next.buildings[0].outline).not.toBe(outline);
    expect(original).not.toHaveProperty("flightProfile");
    expect(drawGeometry(geometryPositions(source, "ROUTE"), "ROUTE")).toEqual(
      source,
    );
  });

  it("新点继承规划默认高度，移动和截尾不改已有高度", () => {
    const profile = {
      reference: "AGL" as const,
      defaultHeightMeters: 125.5,
      waypointHeightsMeters: [60, 170.25],
    };
    expect(resizeRouteFlightProfile(profile, 4).waypointHeightsMeters).toEqual([
      60, 170.25, 125.5, 125.5,
    ]);
    expect(resizeRouteFlightProfile(profile, 1).waypointHeightsMeters).toEqual([
      60,
    ]);
    expect(resizeRouteFlightProfile(profile, 0).waypointHeightsMeters).toEqual(
      [],
    );
    expect(profile.waypointHeightsMeters).toEqual([60, 170.25]);
  });

  it("单点设高不改变默认，批量设高同时更新后续点默认，零高度合法", () => {
    const profile = ensureRouteFlightProfile(null, 3).flightProfile;
    const one = setRouteWaypointHeight(profile, 1, 72.6);
    expect(one).toEqual({
      reference: "AGL",
      defaultHeightMeters: 100,
      waypointHeightsMeters: [100, 72.6, 100],
    });
    const all = setRouteFlightHeight(one, 0);
    expect(all).toEqual({
      reference: "AGL",
      defaultHeightMeters: 0,
      waypointHeightsMeters: [0, 0, 0],
    });
    expect(resizeRouteFlightProfile(all, 4).waypointHeightsMeters).toEqual([
      0, 0, 0, 0,
    ]);
    expect(profile.waypointHeightsMeters).toEqual([100, 100, 100]);
    expect(one.waypointHeightsMeters).toEqual([100, 72.6, 100]);
  });

  it("删除任意点同步移除高度和楼宇关联，后续索引重排且不改来源", () => {
    const initial = {
      version: 1 as const,
      buildings: [building(0), building(1), building(2)],
      flightProfile: {
        reference: "AGL" as const,
        defaultHeightMeters: 100,
        waypointHeightsMeters: [50, 75, 120],
      },
    };
    const next = removeGeometryAssociation(initial, 1);
    expect(next.flightProfile?.waypointHeightsMeters).toEqual([50, 120]);
    expect(next.buildings).toEqual([
      building(0),
      { ...building(2), waypointIndex: 1 },
    ]);
    expect(initial.flightProfile.waypointHeightsMeters).toEqual([50, 75, 120]);
    expect(
      removeGeometryAssociation(next, 0).flightProfile?.waypointHeightsMeters,
    ).toEqual([120]);
    expect(removeGeometryAssociation(initial, -1)).toEqual(initial);
    expect(removeGeometryAssociation(initial, 9)).toEqual(initial);
  });

  it("保存再读取保留本地规划高度，楼宇操作的清洗不会丢失profile", () => {
    const initial = ensureRouteFlightProfile(
      { version: 1, buildings: [building(1)] },
      2,
    );
    initial.flightProfile = setRouteWaypointHeight(
      initial.flightProfile,
      1,
      185,
    );
    const serialized = JSON.stringify(initial);
    const reloaded = ensureRouteFlightProfile(JSON.parse(serialized), 2);
    expect(reloaded).toEqual(initial);
    expect(sanitizeGeometryContext(reloaded, 2)).toEqual(initial);
    expect(
      sanitizeGeometryContext(reloaded, 1).flightProfile?.waypointHeightsMeters,
    ).toEqual([100]);
  });

  it("拒绝未知基准与非法设高，不把来源海拔、字符串或NaN解释为离地高度", () => {
    const context = {
      buildings: [],
      flightProfile: {
        reference: "AMSL",
        defaultHeightMeters: 75,
        waypointHeightsMeters: [50, 60],
      },
    };
    expect(sanitizeGeometryContext(context, 2)).not.toHaveProperty(
      "flightProfile",
    );
    expect(
      ensureRouteFlightProfile(context, 2).flightProfile.waypointHeightsMeters,
    ).toEqual([100, 100]);
    const profile = ensureRouteFlightProfile(null, 2).flightProfile;
    for (const height of [NaN, Infinity, -1, 10_001]) {
      expect(isRouteHeightMeters(height)).toBe(false);
      expect(setRouteWaypointHeight(profile, 0, height)).toEqual(profile);
      expect(setRouteFlightHeight(profile, height)).toEqual(profile);
    }
    expect(isRouteHeightMeters("100")).toBe(false);
    expect(isRouteHeightMeters(0)).toBe(true);
    expect(setRouteWaypointHeight(profile, 0.5, 75)).toEqual(profile);
    expect(setRouteWaypointHeight(profile, 2, 75)).toEqual(profile);
  });

  it("损坏的局部值回退明确规划默认值，缺失点补齐并隔离原对象", () => {
    const input = {
      version: 1,
      buildings: [],
      flightProfile: {
        reference: "AGL",
        defaultHeightMeters: 150,
        waypointHeightsMeters: [0, NaN, "60", -20, 90],
      },
    };
    const next = ensureRouteFlightProfile(input, 6);
    expect(next.flightProfile.waypointHeightsMeters).toEqual([
      0, 150, 150, 150, 90, 150,
    ]);
    next.flightProfile.waypointHeightsMeters[0] = 30;
    expect(input.flightProfile.waypointHeightsMeters[0]).toBe(0);
  });
});

describe("航线编辑几何契约", () => {
  it("源航点精度和高程在解析、移动其他点、保存中保持", () => {
    const points = geometryPositions(JSON.stringify(source), "ROUTE");
    const moved = updateGeometryPoint(points, 1, [120.125, 30.989]);
    expect(drawGeometry(moved, "ROUTE")).toEqual({
      type: "LineString",
      coordinates: [source.coordinates[0], [120.125, 30.989, 91.375]],
    });
    expect(source.coordinates[1]).toEqual([120.124, 30.988, 91.375]);
    expect(points[1]).toEqual([120.124, 30.988, 91.375]);
  });

  it("不为新航点虚构高度，保留已有附加维度", () => {
    const points: GeometryPosition[] = [
      [120, 30, 40, 7],
      [120.1, 30.1],
    ];
    expect(drawGeometry(points, "ROUTE")?.coordinates).toEqual(points);
    expect(geometryPoints(drawGeometry(points, "ROUTE"), "ROUTE")).toEqual([
      [120, 30],
      [120.1, 30.1],
    ]);
  });

  it("删除中间航点后剩余点携带原始高度", () => {
    const points: GeometryPosition[] = [
      [120, 30, 10],
      [121, 31, 20],
      [122, 32, 30],
    ];
    const next = removeGeometryPoint(points, 1);
    expect(next).toEqual([
      [120, 30, 10],
      [122, 32, 30],
    ]);
    next[0][2] = 90;
    expect(points[0][2]).toBe(10);
  });

  it("空域编辑保存保留源内环并只闭合外环一次", () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [120, 30, 40],
          [121, 30, 40],
          [121, 31, 40],
          [120, 30, 40],
        ],
        [
          [120.5, 30.2],
          [120.6, 30.2],
          [120.6, 30.3],
          [120.5, 30.2],
        ],
      ],
    };
    const edited = updateGeometryPoint(
      geometryPositions(polygon, "AIRSPACE"),
      1,
      [121.1, 30],
    );
    const saved = drawGeometry(edited, "AIRSPACE", JSON.stringify(polygon));
    expect(saved?.type).toBe("Polygon");
    if (saved?.type !== "Polygon") throw new Error("Expected polygon");
    expect(saved.coordinates[0]).toEqual([
      [120, 30, 40],
      [121.1, 30, 40],
      [121, 31, 40],
      [120, 30, 40],
    ]);
    expect(saved.coordinates[1]).toEqual(polygon.coordinates[1]);
    saved.coordinates[1][0][0] = 119;
    expect(polygon.coordinates[1][0][0]).toBe(120.5);
    expect(
      drawGeometry(polygon.coordinates[0] as GeometryPosition[], "AIRSPACE")
        ?.coordinates[0],
    ).toHaveLength(4);
  });

  it("仅支持已知几何类型，拒绝非有限值和越界坐标", () => {
    expect(
      geometryPositions({ type: "Point", coordinates: [120, 30] }, "ROUTE"),
    ).toEqual([]);
    expect(
      geometryPositions(
        {
          type: "Unsupported",
          coordinates: [
            [120, 30],
            [121, 31],
          ],
        },
        "ROUTE",
      ),
    ).toEqual([]);
    expect(
      geometryPositions(
        {
          type: "LineString",
          coordinates: [
            [Infinity, 30],
            [120, NaN],
            [180.1, 30],
            [120, 91],
            [120, 30, Infinity],
            [120, 30],
          ],
        },
        "ROUTE",
      ),
    ).toEqual([[120, 30]]);
    expect(
      geometryPositions({ type: "Polygon", coordinates: null }, "AIRSPACE"),
    ).toEqual([]);
    expect(
      drawGeometry(
        [
          [120, 30],
          [Infinity, 31],
        ],
        "ROUTE",
      ),
    ).toBeNull();
    expect(updateGeometryPoint([[120, 30, 50]], 0, [190, 30])).toEqual([
      [120, 30, 50],
    ]);
  });

  it("不足两点不构成航线，空域外环不足三点不能保存", () => {
    expect(drawGeometry([[120, 30, 20]], "ROUTE")).toBeNull();
    expect(
      drawGeometry(
        [
          [120, 30],
          [121, 31],
          [120, 30],
        ],
        "AIRSPACE",
      ),
    ).toBeNull();
  });

  it("长度为水平米数，空线为零且跨日期变更线取近弧", () => {
    expect(routeLengthMeters([])).toBe(0);
    expect(routeLengthMeters([[120, 30, 10]])).toBe(0);
    expect(
      routeLengthMeters([
        [0, 0, 0],
        [0.001, 0, 1000],
      ]),
    ).toBeCloseTo(111.195, 2);
    expect(
      routeLengthMeters([
        [179.999, 0],
        [-179.999, 0],
      ]),
    ).toBeCloseTo(222.39, 2);
    expect(
      routeLengthMeters([
        [120, 30],
        [120, 30],
      ]),
    ).toBe(0);
  });
});

describe("航点与楼宇关联元数据", () => {
  it("单栋楼宇轮廓随关联保存并隔离无效轮廓，不改变未知高度", () => {
    const outline = [
      [120, 30],
      [120.001, 30],
      [120.001, 30.001],
      [120, 30],
    ];
    const source = {
      buildings: [
        { ...building(0), outline },
        {
          ...building(1),
          outline: [
            [200, 30],
            [120, 30],
            [120, 30],
          ],
        },
      ],
    };
    const result = sanitizeGeometryContext(source, 2);
    expect(result.buildings[0].outline).toEqual(outline);
    expect(result.buildings[0].outline).not.toBe(outline);
    expect(result.buildings[1].outline).toBeUndefined();
    expect(result.buildings[0].heightMeters).toBeNull();
    expect(removeGeometryAssociation(result, 1).buildings[0].outline).toEqual(
      outline,
    );
  });
  it("删除航点时解除对应楼宇，后续索引前移且源数据不变", () => {
    const context = {
      version: 1,
      buildings: [building(0), building(1), building(2)],
    };
    expect(removeGeometryAssociation(context, 1)).toEqual({
      version: 1,
      buildings: [building(0), { ...building(2), waypointIndex: 1 }],
    });
    expect(context.buildings.map((item) => item.waypointIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(
      removeGeometryAssociation(context, 2).buildings.map(
        (item) => item.waypointIndex,
      ),
    ).toEqual([0, 1]);
  });

  it("丢弃越界、未知ID或错误坐标的关联", () => {
    const context = {
      version: 1,
      buildings: [
        building(0),
        building(3),
        { ...building(1), id: "" },
        { ...building(2), center: [190, 30] },
        { ...building(1), waypointIndex: 0.5 },
      ],
    };
    expect(sanitizeGeometryContext(context, 3).buildings).toEqual([
      building(0),
    ]);
    expect(sanitizeGeometryContext(null, 2)).toEqual({
      version: 1,
      buildings: [],
    });
    expect(
      sanitizeGeometryContext({ buildings: [building(0)] }, 0).buildings,
    ).toEqual([]);
  });

  it("未知高度保持null，合法零高度不当成缺失值", () => {
    const context = {
      buildings: [
        { ...building(0), heightMeters: 0 },
        { ...building(1), heightMeters: "65" },
        { ...building(2), heightMeters: -1 },
      ],
    };
    expect(
      sanitizeGeometryContext(context, 3).buildings.map(
        (item) => item.heightMeters,
      ),
    ).toEqual([0, null, null]);
  });

  it("同一航点重新选楼宇时保留最新关联且不污染GeoJSON", () => {
    const context = sanitizeGeometryContext(
      { buildings: [building(0, "old"), building(0, "new")] },
      2,
    );
    expect(context.buildings).toEqual([building(0, "new")]);
    expect(drawGeometry(geometryPositions(source, "ROUTE"), "ROUTE")).toEqual(
      source,
    );
  });
});
