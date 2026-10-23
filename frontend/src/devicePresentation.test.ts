import { describe, expect, it } from "vitest";
import {
  resolveDevicePresentation,
  showsFlightHistory,
} from "./devicePresentation";

describe("设备展示分类", () => {
  it("通用档案大类不遮蔽来源类型，未知类型不按名称或productKey猜测", () => {
    expect(
      resolveDevicePresentation({
        id: "1",
        kind: "DEVICE",
        type: "UAV_AIRPORT",
      }),
    ).toMatchObject({ category: "DOCK", layer: "sites" });
    expect(
      resolveDevicePresentation({
        id: "2",
        kind: "DEVICE",
        metadata: { sourceDeviceType: "CAMERA" },
      }),
    ).toMatchObject({ category: "CAMERA", layer: "equipment" });
    expect(
      resolveDevicePresentation({
        id: "3",
        type: "CAMERA",
        name: "无人机",
        productKey: "uav",
      }).category,
    ).toBe("CAMERA");
    expect(
      resolveDevicePresentation({
        id: "4",
        type: "BODY_UNKNOWN",
        name: "执法仪",
      }),
    ).toMatchObject({ category: "UNKNOWN", rawType: "BODY_UNKNOWN" });
    expect(
      resolveDevicePresentation({ id: "5", kind: "DEVICE", productKey: "uav" })
        .category,
    ).toBe("UNKNOWN");
  });

  it("航空器显示历史，机巢须提供至少一个有效统计，其他类型不使用飞行统计", () => {
    expect(showsFlightHistory({ id: "1", type: "UAV" })).toBe(true);
    for (const flightTotals of [
      {},
      { reportedAt: "2026-10-23T00:00:00Z" },
      { sorties: null },
      { sorties: -1 },
    ])
      expect(showsFlightHistory({ id: "2", type: "DOCK", flightTotals })).toBe(
        false,
      );
    expect(
      showsFlightHistory({
        id: "2",
        type: "DOCK",
        flightTotals: { sorties: 0 },
      }),
    ).toBe(true);
    expect(
      showsFlightHistory({
        id: "2",
        type: "DOCK",
        flightTotals: { timeSeconds: 12 },
      }),
    ).toBe(true);
    for (const type of ["CAMERA", "RADAR", "AI_POD", "UNKNOWN"])
      expect(
        showsFlightHistory({ id: "3", type, flightTotals: { sorties: 2 } }),
      ).toBe(false);
  });
});
