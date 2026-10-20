import { describe, expect, it } from "vitest";
import type { Entity } from "./api";
import {
  deviceObservationStatus,
  onlineDevicesFirst,
  resolveFlightDevice,
} from "./flightDeviceOrder";

const now = Date.parse("2026-10-16T03:00:00Z");
const observed = (id: string, status: string, age = 0): Entity => ({
  id,
  status,
  lastObservedAt: new Date(now - age).toISOString(),
});

describe("飞行管控在线设备优先", () => {
  it("在线设备排在最前，同组维持来源顺序，统计不会改变顺序", () => {
    const devices = [
      { ...observed("offline-1", "OFFLINE"), flightTotals: { sorties: 999 } },
      observed("900719925474099312345", "ONLINE"),
      observed("unknown-1", "UNKNOWN"),
      { ...observed("online-2", "ONLINE"), flightTotals: { sorties: 15 } },
      observed("offline-2", "OFFLINE"),
    ];
    const original = [...devices];
    expect(onlineDevicesFirst(devices, now).map((device) => device.id)).toEqual(
      [
        "900719925474099312345",
        "online-2",
        "offline-1",
        "unknown-1",
        "offline-2",
      ],
    );
    expect(devices).toEqual(original);
  });

  it("超过 60 秒的在线状态降为未知，不会排在有效在线设备前", () => {
    const stale = observed("stale", "ONLINE", 60_001);
    const fresh = observed("fresh", "ONLINE", 60_000);
    expect(deviceObservationStatus(stale, now)).toBe("UNKNOWN");
    expect(deviceObservationStatus(fresh, now)).toBe("ONLINE");
    expect(onlineDevicesFirst([stale, fresh], now)).toEqual([fresh, stale]);
  });

  it.each([undefined, null, "", "invalid", 123])(
    "没有有效观测时间 %s 时保留未知，不猜测在线",
    (lastObservedAt) => {
      expect(
        deviceObservationStatus(
          { id: "x", status: "ONLINE", lastObservedAt },
          now,
        ),
      ).toBe("UNKNOWN");
    },
  );

  it("遵守来源未来时钟容差，明确的离线状态保持离线", () => {
    expect(deviceObservationStatus(observed("x", "ONLINE", -30_000), now)).toBe(
      "ONLINE",
    );
    expect(deviceObservationStatus(observed("x", "ONLINE", -30_001), now)).toBe(
      "UNKNOWN",
    );
    expect(deviceObservationStatus(observed("x", "OFFLINE"), now)).toBe(
      "OFFLINE",
    );
  });
});

describe("管控默认选择和指定设备入口", () => {
  const offline = observed("offline", "OFFLINE");
  const online = observed("online", "ONLINE");
  const anotherOnline = observed("another-online", "ONLINE");
  const devices = [offline, online, anotherOnline];

  it("无指定设备时默认选择排序后的第一台在线设备", () => {
    const rows = onlineDevicesFirst(devices, now);
    expect(resolveFlightDevice(devices, rows, {})?.id).toBe("online");
  });

  it("轮询后其他设备排到第一，仍保持正在查看的设备", () => {
    const refreshed = [
      anotherOnline,
      { ...online, status: "UNKNOWN" },
      offline,
    ];
    expect(
      resolveFlightDevice(refreshed, onlineDevicesFirst(refreshed, now), {
        selectedId: "online",
      })?.id,
    ).toBe("online");
  });

  it("显式 deviceId 即使离线、被筛选隐藏，也不被在线默认项覆盖", () => {
    expect(
      resolveFlightDevice(devices, [online], {
        deviceId: "offline",
        selectedId: "online",
      })?.id,
    ).toBe("offline");
    expect(
      resolveFlightDevice(devices, [online], { deviceId: "not-authorized" }),
    ).toBeUndefined();
  });

  it("只有任务入口时等绑定设备，不回退到不相关的在线设备", () => {
    expect(
      resolveFlightDevice(devices, [online], { taskId: "task-1" }),
    ).toBeUndefined();
    expect(
      resolveFlightDevice(devices, [online], {
        taskId: "task-1",
        taskSourceDeviceId: "offline",
      })?.id,
    ).toBe("offline");
  });

  it("当前默认设备被筛选掉或撤销可见权限后，选择剩余在线首项", () => {
    expect(
      resolveFlightDevice([online], [online], { selectedId: "offline" })?.id,
    ).toBe("online");
    expect(
      resolveFlightDevice([], [], { selectedId: "offline" }),
    ).toBeUndefined();
  });
});
