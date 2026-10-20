import { describe, expect, it } from "vitest";
import { getFlightTotals, summarizeFlightTotals } from "./flightStatistics";

describe("真实累计统计", () => {
  it("不把未上报设备记为零，并保留明确的零值", () => {
    expect(summarizeFlightTotals([{ id: "airport" }])).toEqual({
      devicesWithStatistics: 0,
      sorties: null,
      timeSeconds: null,
      distanceMeters: null,
    });
    expect(
      getFlightTotals({
        id: "uav",
        flightTotals: { sorties: 0, timeSeconds: 0, distanceMeters: 0 },
      })?.sorties,
    ).toBe(0);
  });
  it("仅汇总有累计上报的设备，历史留存条数不能替代累计架次", () => {
    const totals = summarizeFlightTotals([
      {
        id: "uav-1",
        flightTotals: {
          sorties: 500,
          timeSeconds: 9000,
          distanceMeters: 12500,
        },
      },
      {
        id: "uav-2",
        flightTotals: {
          sorties: 1000,
          timeSeconds: 3000,
          distanceMeters: 2500,
        },
      },
      { id: "airport" },
    ]);
    expect(totals).toEqual({
      devicesWithStatistics: 2,
      sorties: 1500,
      timeSeconds: 12000,
      distanceMeters: 15000,
    });
  });
  it("部分设备的指标缺失时不展示不完整的合计", () => {
    const result = summarizeFlightTotals([
      { id: "a", flightTotals: { sorties: 5, timeSeconds: null } },
      { id: "b", flightTotals: { sorties: 2, timeSeconds: 100 } },
    ]);
    expect(result.sorties).toBe(7);
    expect(result.timeSeconds).toBeNull();
  });
});
