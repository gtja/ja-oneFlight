import type { Entity } from "./api";

/** Match the provider's 60-second observation window and 30-second clock tolerance. */
export function deviceObservationStatus(device: Entity, now = Date.now()) {
  const observedAt =
    typeof device.lastObservedAt === "string"
      ? Date.parse(device.lastObservedAt)
      : NaN;
  const age = now - observedAt;
  if (!Number.isFinite(age) || age > 60_000 || age < -30_000) return "UNKNOWN";
  return device.status === "ONLINE" || device.status === "OFFLINE"
    ? device.status
    : "UNKNOWN";
}

/** Stable partition: statistics and stale observations never promote a device. */
export function onlineDevicesFirst(
  devices: readonly Entity[],
  now = Date.now(),
): Entity[] {
  const online: Entity[] = [];
  const other: Entity[] = [];
  for (const device of devices)
    (deviceObservationStatus(device, now) === "ONLINE" ? online : other).push(
      device,
    );
  return [...online, ...other];
}

export function resolveFlightDevice(
  devices: readonly Entity[],
  visibleDevices: readonly Entity[],
  selection: {
    deviceId?: string;
    taskId?: string;
    taskSourceDeviceId?: string;
    selectedId?: string;
  },
) {
  // A task or explicit URL must never silently open an unrelated online device.
  if (selection.deviceId)
    return devices.find((device) => device.id === selection.deviceId);
  if (selection.taskId)
    return devices.find((device) => device.id === selection.taskSourceDeviceId);
  return (
    visibleDevices.find((device) => device.id === selection.selectedId) ||
    visibleDevices[0]
  );
}
