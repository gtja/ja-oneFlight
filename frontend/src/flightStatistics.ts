import type { Entity } from "./api";

export type FlightTotals = {
  sorties: number | null;
  timeSeconds: number | null;
  distanceMeters: number | null;
  reportedAt: string | null;
};

export function getFlightTotals(device?: Entity): FlightTotals | null {
  const raw = device?.flightTotals;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const values = raw as Record<string, unknown>;
  const metric = (key: string) =>
    typeof values[key] === "number" &&
    Number.isFinite(values[key]) &&
    values[key] >= 0
      ? (values[key] as number)
      : null;
  return {
    sorties: metric("sorties"),
    timeSeconds: metric("timeSeconds"),
    distanceMeters: metric("distanceMeters"),
    reportedAt:
      typeof values.reportedAt === "string" ? values.reportedAt : null,
  };
}

export function summarizeFlightTotals(devices: Entity[]) {
  const values = devices
    .map(getFlightTotals)
    .filter((v): v is FlightTotals => v !== null);
  const sum = (key: "sorties" | "timeSeconds" | "distanceMeters") =>
    values.length && values.every((value) => value[key] !== null)
      ? values.reduce((total, value) => total + value[key]!, 0)
      : null;
  return {
    devicesWithStatistics: values.length,
    sorties: sum("sorties"),
    timeSeconds: sum("timeSeconds"),
    distanceMeters: sum("distanceMeters"),
  };
}
