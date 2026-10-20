import { describe, expect, it } from "vitest";
import {
  AIRCRAFT,
  FLIGHT_CENTER,
  FlightClock,
  flightPose,
  orientAircraft,
  projectFlightPoint,
} from "./flightSimulationMath";

describe("航空器三维巡航", () => {
  it("四架飞机包含两种机型，路线在钱塘江局部范围闭合且高度始终为120–420米AGL", () => {
    expect(AIRCRAFT.filter((item) => item.kind === "multirotor")).toHaveLength(
      2,
    );
    expect(AIRCRAFT.filter((item) => item.kind === "fixed-wing")).toHaveLength(
      2,
    );
    AIRCRAFT.forEach((aircraft, index) => {
      for (let sample = 0; sample <= 200; sample++) {
        const pose = flightPose(index, (aircraft.period * sample) / 200);
        expect(Object.values(pose).every(Number.isFinite)).toBe(true);
        expect(pose.heightMeters).toBeGreaterThanOrEqual(120);
        expect(pose.heightMeters).toBeLessThanOrEqual(420);
        expect(Math.abs(pose.longitude - FLIGHT_CENTER[0])).toBeLessThan(0.008);
        expect(Math.abs(pose.latitude - FLIGHT_CENTER[1])).toBeLessThan(0.004);
        expect(pose.speed).toBeGreaterThan(1);
      }
      const start = flightPose(index, 0);
      const end = flightPose(index, aircraft.period);
      expect(end.longitude).toBeCloseTo(start.longitude, 10);
      expect(end.latitude).toBeCloseTo(start.latitude, 10);
      expect(end.heightMeters).toBeCloseTo(start.heightMeters, 8);
      expect(Math.sin(end.heading)).toBeCloseTo(Math.sin(start.heading), 7);
      expect(Math.cos(end.heading)).toBeCloseTo(Math.cos(start.heading), 7);
      const before = flightPose(index, aircraft.period - 0.001);
      const after = flightPose(index, aircraft.period + 0.001);
      expect(
        Math.hypot(after.east - before.east, after.north - before.north),
      ).toBeLessThan(0.1);
    });
  });

  it("暂停、后台与样式重建挂起时钟；恢复后不追补墙上时间；重开从零开始", () => {
    const clock = new FlightClock();
    clock.advance(1000);
    expect(clock.advance(2500)).toBe(1.5);
    clock.suspend();
    expect(clock.advance(100_000)).toBe(1.5);
    expect(clock.advance(101_000)).toBe(2.5);
    clock.reset();
    expect(clock.seconds).toBe(0);
    expect(clock.advance(500_000)).toBe(0);
    expect(clock.advance(501_000)).toBe(1);
  });

  it("航向、爬升与滚转真实旋转模型，保持向量长度", () => {
    const north = { x: 0, y: 10, z: 0 };
    expect(
      orientAircraft(north, { heading: Math.PI / 2, pitch: 0, bank: 0 }).x,
    ).toBeCloseTo(10);
    expect(
      orientAircraft(north, { heading: 0, pitch: Math.PI / 6, bank: 0 }).z,
    ).toBeCloseTo(5);
    const rolled = orientAircraft(
      { x: 10, y: 0, z: 0 },
      { heading: 0, pitch: 0, bank: Math.PI / 6 },
    );
    expect(rolled.z).toBeCloseTo(-5);
    const vector = orientAircraft(
      { x: 3, y: 4, z: 12 },
      { heading: 1.2, pitch: 0.2, bank: -0.4 },
    );
    expect(Math.hypot(vector.x, vector.y, vector.z)).toBeCloseTo(13);
  });

  it("相机矩阵投影保留世界高度和深度，拒绝相机背后及视锥外的点", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const tilted = [...identity];
    tilted[9] = 0.6;
    const ground = projectFlightPoint(tilted, { x: 0.1, y: 0.2, z: 0.1 })!;
    const air = projectFlightPoint(tilted, { x: 0.1, y: 0.2, z: 0.4 })!;
    expect(air.y - ground.y).toBeCloseTo(0.18);
    expect(air.z - ground.z).toBeCloseTo(0.3);
    expect(projectFlightPoint(identity, { x: 0, y: 0, z: 2 })).toBeNull();
    identity[15] = -1;
    expect(projectFlightPoint(identity, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});
