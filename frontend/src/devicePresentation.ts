import type { Entity } from "./api";
import { getFlightTotals } from "./flightStatistics";

export type DeviceCategory =
  "AIRCRAFT" | "DOCK" | "CAMERA" | "RADAR" | "COMPUTE" | "UNKNOWN";

export type DevicePresentation = {
  category: DeviceCategory;
  label: string;
  layer: "devices" | "sites" | "detectors" | "equipment";
  rawType: string | null;
};

const knownTypes: Record<string, Omit<DevicePresentation, "rawType">> = {
  UAV: { category: "AIRCRAFT", label: "航空器", layer: "devices" },
  UAV_AIRPORT: { category: "DOCK", label: "机巢", layer: "sites" },
  DOCK: { category: "DOCK", label: "机巢", layer: "sites" },
  AIRPORT: { category: "DOCK", label: "机场", layer: "sites" },
  LANDING_SITE: { category: "DOCK", label: "起降点", layer: "sites" },
  CAMERA: { category: "CAMERA", label: "摄像机", layer: "equipment" },
  RADAR: { category: "RADAR", label: "雷达", layer: "detectors" },
  DETECTOR: { category: "RADAR", label: "探测设备", layer: "detectors" },
  AI_POD: { category: "COMPUTE", label: "算力舱", layer: "equipment" },
};

/** Display classification only: never infer capabilities or authorization from a name. */
export function resolveDevicePresentation(device: Entity): DevicePresentation {
  const metadata = device.metadata as Record<string, unknown> | undefined;
  const rawType = [
    device.type,
    device.deviceType,
    metadata?.sourceDeviceType,
    device.kind,
  ].find(
    (value): value is string =>
      typeof value === "string" &&
      value.trim() !== "" &&
      value.trim().toUpperCase() !== "DEVICE",
  );
  const normalized = rawType?.trim().toUpperCase();
  return {
    ...(normalized && knownTypes[normalized]
      ? knownTypes[normalized]
      : {
          category: "UNKNOWN" as const,
          label: rawType ? "其他设备" : "设备类型未知",
          layer: "equipment" as const,
        }),
    rawType: rawType?.trim() || null,
  };
}

export function showsFlightHistory(device: Entity): boolean {
  const { category } = resolveDevicePresentation(device);
  if (category === "AIRCRAFT") return true;
  if (category !== "DOCK") return false;
  const totals = getFlightTotals(device);
  return (
    !!totals &&
    [totals.sorties, totals.timeSeconds, totals.distanceMeters].some(
      (value) => value !== null,
    )
  );
}
