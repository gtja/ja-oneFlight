import { describe, expect, it } from "vitest";
import {
  hasMapObjectLocation,
  mapObjectGeometry,
  mapObjectLocation,
  objectCoordinates,
} from "./mapObjectFocus";

describe("地图对象的真实位置与几何范围", () => {
  it("接受来源经纬度和遥测，拒绝缺失值、空串、布尔值与越界坐标", () => {
    expect(
      objectCoordinates({
        id: "telemetry",
        latestTelemetry: { longitude: "120.1", latitude: "30.2" },
      }),
    ).toEqual([120.1, 30.2]);
    for (const value of [
      null,
      undefined,
      "",
      " ",
      false,
      true,
      Infinity,
      NaN,
      181,
    ]) {
      expect(
        hasMapObjectLocation({ id: "unknown", longitude: value, latitude: 30 }),
      ).toBe(false);
    }
    expect(
      objectCoordinates({ id: "zero", longitude: 0, latitude: 0 }),
    ).toEqual([0, 0]);
  });
  it("航线按全部来源顶点取范围，空域按全部多边形取范围，保留来源Z", () => {
    const geometry = {
      type: "LineString",
      coordinates: [
        [120.1, 30.3, 70],
        [120.3, 30.1, 90],
        [120.2, 30.4, 85],
      ],
    };
    const entity = {
      id: "route",
      kind: "ROUTE",
      longitude: 121,
      latitude: 31,
      metadata: { geometry: JSON.stringify(geometry) },
    };
    expect(mapObjectGeometry(entity)).toEqual(geometry);
    expect(mapObjectLocation(entity)).toEqual({
      bounds: [
        [120.1, 30.1],
        [120.3, 30.4],
      ],
    });
    expect(
      mapObjectLocation({
        id: "areas",
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [120, 30],
                [121, 30],
                [121, 31],
                [120, 30],
              ],
            ],
            [
              [
                [122, 32],
                [123, 32],
                [123, 33],
                [122, 32],
              ],
            ],
          ],
        },
      }),
    ).toEqual({
      bounds: [
        [120, 30],
        [123, 33],
      ],
    });
  });
  it("支持GeoJSON Feature/GeometryCollection中的点，畸形几何不补点也不定位", () => {
    expect(
      mapObjectLocation({
        id: "point",
        geometry: {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [120, 30] },
        },
      }),
    ).toEqual({ point: [120, 30] });
    expect(
      mapObjectLocation({
        id: "group",
        geometry: {
          type: "GeometryCollection",
          geometries: [
            { type: "Point", coordinates: [120, 30] },
            { type: "Point", coordinates: [122, 31] },
          ],
        },
      }),
    ).toEqual({
      bounds: [
        [120, 30],
        [122, 31],
      ],
    });
    for (const geometry of [
      "{bad-json",
      { type: "Polygon", coordinates: [] },
      {
        type: "Polygon",
        coordinates: [
          [
            [120, 30],
            [121, 30],
            [121, 31],
          ],
        ],
      },
      {
        type: "LineString",
        coordinates: [
          [120, 30],
          ["bad", 31],
        ],
      },
      { type: "GeometryCollection", geometries: [] },
    ])
      expect(hasMapObjectLocation({ id: "invalid", geometry })).toBe(false);
  });
});
