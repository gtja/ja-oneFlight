import { describe, expect, it } from "vitest";
import {
  AircraftReportHistory,
  DemoAircraftReportProvider,
  MAX_REPORTS_PER_AIRCRAFT,
  reportedAircraftPosition,
  validAircraftReport,
  type AircraftPositionReport,
} from "./flightReports";

const epoch = 1_750_000_000_000;
const point = (
  second: number,
  extra: Partial<AircraftPositionReport> = {},
): AircraftPositionReport => ({
  deviceId: "real-aircraft",
  timestamp: epoch + second * 1000,
  longitude: 120 + second * 0.0001,
  latitude: 30,
  altitudeMeters: 120 + second,
  altitudeReference: "AGL",
  ...extra,
});

describe("独立位置上报与历史", () => {
  it("拒绝非法点与缺失高度基准，允许低于海平面的AMSL；清理无效可选速度/航向", () => {
    for (const invalid of [
      null,
      point(0, { longitude: 181 }),
      point(0, { latitude: 91 }),
      point(0, { timestamp: NaN }),
      point(0, { altitudeMeters: NaN }),
      point(0, { altitudeMeters: -1 }),
      point(0, { altitudeReference: undefined }),
      point(0, { deviceId: " " }),
    ])
      expect(validAircraftReport(invalid as AircraftPositionReport)).toBe(
        false,
      );
    expect(
      validAircraftReport(
        point(0, { altitudeMeters: -30, altitudeReference: "AMSL" }),
      ),
    ).toBe(true);
    const history = new AircraftReportHistory();
    history.ingest(
      [point(0, { headingDegrees: NaN, speedMetersPerSecond: -2 })],
      0,
    );
    const saved = history.snapshot().get("real-aircraft")!.reports[0];
    expect(saved.headingDegrees).toBeUndefined();
    expect(saved.speedMetersPerSecond).toBeUndefined();
  });

  it("按设备隔离，乱序排序，同时间戳新值覆盖，迟到历史不重启最新点插值", () => {
    const history = new AircraftReportHistory();
    history.ingest(
      [
        point(3),
        point(1),
        point(2),
        point(1, { altitudeMeters: 180 }),
        point(1, { deviceId: "other" }),
      ],
      4,
    );
    const before = history.snapshot();
    expect(
      before.get("real-aircraft")!.reports.map((report) => report.timestamp),
    ).toEqual([epoch + 1000, epoch + 2000, epoch + 3000]);
    expect(before.get("real-aircraft")!.reports[0].altitudeMeters).toBe(180);
    expect(before.get("other")!.reports).toHaveLength(1);
    history.ingest([point(0)], 8);
    expect(history.snapshot().get("real-aircraft")!.receivedAtSeconds).toBe(4);
    expect(before.get("real-aircraft")!.reports).toHaveLength(3);
    history.ingest([], 9);
    expect(history.snapshot().get("real-aircraft")!.reports).toHaveLength(4);
  });

  it("每架设备保留最近10000个点，按时间上限截断而非30秒尾迹", () => {
    const history = new AircraftReportHistory();
    history.ingest(
      Array.from({ length: MAX_REPORTS_PER_AIRCRAFT + 5 }, (_, i) => point(i)),
      1,
    );
    const reports = history.snapshot().get("real-aircraft")!.reports;
    expect(reports).toHaveLength(10000);
    expect(reports[0].timestamp).toBe(epoch + 5000);
    expect(reports.at(-1)!.timestamp).toBe(epoch + 10004 * 1000);
  });

  it("1Hz provider初始只预置过去20秒；暂停时间不推进就无新点；35秒后首点仍保留", () => {
    const provider = new DemoAircraftReportProvider(epoch),
      history = new AircraftReportHistory();
    const initial = provider.initialReports();
    history.ingest(initial, 0);
    expect(initial).toHaveLength(84);
    expect(initial.every((report) => report.timestamp <= epoch)).toBe(true);
    expect(provider.advance(0.99)).toEqual([]);
    expect(provider.advance(1)).toHaveLength(4);
    expect(provider.advance(1)).toEqual([]);
    history.ingest(provider.advance(35), 35);
    const track = history.snapshot().get("patrol-01")!;
    expect(track.reports[0].timestamp).toBe(epoch - 20000);
    expect(track.reports.at(-1)!.timestamp).toBe(epoch + 35000);
    expect(track.reports.length).toBeGreaterThan(30);
  });

  it("仅在两个已知上报点之间插值，到末点就停；无新报告也不外推", () => {
    const history = new AircraftReportHistory();
    history.ingest([point(0), point(1)], 5);
    const track = history.snapshot().get("real-aircraft")!;
    expect(reportedAircraftPosition(track, 5)!.longitude).toBeCloseTo(120);
    expect(reportedAircraftPosition(track, 5.5)!.longitude).toBeCloseTo(
      120.00005,
    );
    const end = reportedAircraftPosition(track, 6)!;
    expect(end.timestamp).toBe(epoch + 1000);
    expect(end.longitude).toBeCloseTo(120.0001);
    expect(reportedAircraftPosition(track, 1000)).toEqual(end);
  });

  it("不同高度基准不混合插值，来源给定航向速度被明确采用", () => {
    const history = new AircraftReportHistory();
    history.ingest(
      [
        point(0),
        point(1, {
          altitudeReference: "AMSL",
          altitudeMeters: 240,
          headingDegrees: 450,
          speedMetersPerSecond: 12,
        }),
      ],
      0,
    );
    const position = reportedAircraftPosition(
      history.snapshot().get("real-aircraft"),
      0,
    )!;
    expect(position.altitudeReference).toBe("AMSL");
    expect(position.altitudeMeters).toBe(240);
    expect(position.headingDegrees).toBe(90);
    expect(position.speedMetersPerSecond).toBe(12);
  });

  it("同时间戳的最新点修正只更新位置，不重启上一航段而倒飞", () => {
    const history = new AircraftReportHistory();
    history.ingest([point(0), point(1)], 0);
    const settled = reportedAircraftPosition(
      history.snapshot().get("real-aircraft"),
      2,
    )!;
    history.ingest([point(1, { longitude: 120.00015 })], 2);
    const corrected = reportedAircraftPosition(
      history.snapshot().get("real-aircraft"),
      2,
    )!;
    expect(corrected.timestamp).toBe(settled.timestamp);
    expect(corrected.longitude).toBe(120.00015);
  });
});
