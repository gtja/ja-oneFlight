import { AIRCRAFT, flightPose } from "./flightSimulationMath";

export type AircraftAltitudeReference = "AGL" | "AMSL";
export type AircraftFlightDefinition = {
  deviceId: string;
  name: string;
  kind: "multirotor" | "fixed-wing";
  color?: [number, number, number];
};

/** timestamp is the observation time in UTC epoch milliseconds. Height basis is mandatory. */
export type AircraftPositionReport = {
  deviceId: string;
  timestamp: number;
  longitude: number;
  latitude: number;
  altitudeMeters: number;
  altitudeReference: AircraftAltitudeReference;
  headingDegrees?: number;
  speedMetersPerSecond?: number;
};

export type AircraftReportTrack = {
  readonly reports: readonly AircraftPositionReport[];
  readonly receivedAtSeconds: number;
};
export type AircraftReportSnapshot = ReadonlyMap<string, AircraftReportTrack>;
export type AircraftReportedPosition = AircraftPositionReport & {
  headingDegrees: number;
  speedMetersPerSecond: number;
  pitchRadians: number;
};

export const MAX_REPORTS_PER_AIRCRAFT = 10_000;
export const DEFAULT_AIRCRAFT_DEFINITIONS: readonly AircraftFlightDefinition[] =
  AIRCRAFT.map((aircraft) => ({
    deviceId: aircraft.id,
    name: aircraft.name,
    kind: aircraft.kind,
    color: aircraft.color,
  }));

export function validAircraftReport(report: AircraftPositionReport): boolean {
  return (
    Boolean(report) &&
    typeof report === "object" &&
    typeof report.deviceId === "string" &&
    report.deviceId.trim().length > 0 &&
    Number.isSafeInteger(report.timestamp) &&
    report.timestamp >= 0 &&
    Number.isFinite(report.longitude) &&
    Math.abs(report.longitude) <= 180 &&
    Number.isFinite(report.latitude) &&
    Math.abs(report.latitude) <= 85.05112878 &&
    Number.isFinite(report.altitudeMeters) &&
    (report.altitudeReference === "AGL"
      ? report.altitudeMeters >= 0
      : report.altitudeReference === "AMSL")
  );
}

const safeCopy = (report: AircraftPositionReport): AircraftPositionReport => ({
  deviceId: report.deviceId,
  timestamp: report.timestamp,
  longitude: report.longitude,
  latitude: report.latitude,
  altitudeMeters: report.altitudeMeters,
  altitudeReference: report.altitudeReference,
  ...(Number.isFinite(report.headingDegrees)
    ? { headingDegrees: ((report.headingDegrees! % 360) + 360) % 360 }
    : {}),
  ...(Number.isFinite(report.speedMetersPerSecond) &&
  report.speedMetersPerSecond! >= 0
    ? { speedMetersPerSecond: report.speedMetersPerSecond }
    : {}),
});

function sameReport(
  a: AircraftPositionReport | undefined,
  b: AircraftPositionReport | undefined,
) {
  return (
    a?.timestamp === b?.timestamp &&
    a?.longitude === b?.longitude &&
    a?.latitude === b?.latitude &&
    a?.altitudeMeters === b?.altitudeMeters &&
    a?.altitudeReference === b?.altitudeReference &&
    a?.headingDegrees === b?.headingDegrees &&
    a?.speedMetersPerSecond === b?.speedMetersPerSecond
  );
}

/** Immutable per-device arrays make an independent frozen presentation snapshot inexpensive. */
export class AircraftReportHistory {
  private tracks = new Map<string, AircraftReportTrack>();
  ingest(
    reports: readonly AircraftPositionReport[],
    receivedAtSeconds: number,
  ) {
    const batches = new Map<string, AircraftPositionReport[]>();
    for (const report of reports) {
      if (!validAircraftReport(report)) continue;
      if (!batches.has(report.deviceId)) batches.set(report.deviceId, []);
      batches.get(report.deviceId)!.push(safeCopy(report));
    }
    for (const [id, batch] of batches) {
      const previous = this.tracks.get(id);
      const byTime = new Map(
        (previous?.reports || []).map((report) => [report.timestamp, report]),
      );
      batch.forEach((report) => byTime.set(report.timestamp, report));
      const ordered = [...byTime.values()]
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-MAX_REPORTS_PER_AIRCRAFT);
      if (
        ordered.length === previous?.reports.length &&
        ordered.every((report, index) =>
          sameReport(report, previous.reports[index]),
        )
      )
        continue;
      this.tracks.set(id, {
        reports: ordered,
        receivedAtSeconds:
          previous?.reports.at(-1)?.timestamp === ordered.at(-1)?.timestamp
            ? previous!.receivedAtSeconds
            : receivedAtSeconds,
      });
    }
  }
  snapshot(): AircraftReportSnapshot {
    return new Map(this.tracks);
  }
  clear() {
    this.tracks.clear();
  }
}

function segmentMotion(a: AircraftPositionReport, b: AircraftPositionReport) {
  const latitude = ((a.latitude + b.latitude) * Math.PI) / 360;
  const longitudeDelta = ((b.longitude - a.longitude + 540) % 360) - 180;
  const east = longitudeDelta * Math.cos(latitude) * 111_195;
  const north = (b.latitude - a.latitude) * 111_195;
  const distance = Math.hypot(east, north);
  const duration = (b.timestamp - a.timestamp) / 1000;
  return {
    speed: duration > 0 ? distance / duration : 0,
    heading: ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360,
    pitch:
      a.altitudeReference === b.altitudeReference
        ? Math.atan2(b.altitudeMeters - a.altitudeMeters, distance || 1)
        : 0,
  };
}

/** At most one second of interpolation between observations, clamped to the latest report. */
export function reportedAircraftPosition(
  track: AircraftReportTrack | undefined,
  elapsedSeconds: number,
): AircraftReportedPosition | null {
  const reports = track?.reports;
  if (!reports?.length) return null;
  const latest = reports.at(-1)!;
  const previous = reports.at(-2);
  const motion = previous
    ? segmentMotion(previous, latest)
    : { speed: 0, heading: 0, pitch: 0 };
  const resolved = (
    point: AircraftPositionReport,
  ): AircraftReportedPosition => ({
    ...point,
    headingDegrees: latest.headingDegrees ?? motion.heading,
    speedMetersPerSecond: latest.speedMetersPerSecond ?? motion.speed,
    pitchRadians: Math.max(-0.3, Math.min(0.3, motion.pitch)),
  });
  if (!previous || previous.altitudeReference !== latest.altitudeReference)
    return resolved(latest);
  const duration = Math.min(1000, latest.timestamp - previous.timestamp);
  const target =
    latest.timestamp -
    duration +
    Math.max(
      0,
      Math.min(duration, (elapsedSeconds - track!.receivedAtSeconds) * 1000),
    );
  if (target >= latest.timestamp) return resolved(latest);
  let lo = 0,
    hi = reports.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (reports[mid].timestamp <= target) lo = mid;
    else hi = mid;
  }
  const a = reports[lo],
    b = reports[hi];
  if (a.altitudeReference !== b.altitudeReference) return resolved(b);
  const t = Math.max(
    0,
    Math.min(1, (target - a.timestamp) / (b.timestamp - a.timestamp)),
  );
  const delta = ((b.longitude - a.longitude + 540) % 360) - 180;
  return resolved({
    ...b,
    timestamp: target,
    longitude: ((a.longitude + delta * t + 540) % 360) - 180,
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    altitudeMeters:
      a.altitudeMeters + (b.altitudeMeters - a.altitudeMeters) * t,
  });
}

/** Local 1 Hz source; renderer consumes these observations exactly like future real reports. */
export class DemoAircraftReportProvider {
  private lastSecond = 0;
  constructor(readonly epochMilliseconds = Date.now()) {}
  private reportsAt(second: number): AircraftPositionReport[] {
    return AIRCRAFT.map((aircraft, index) => {
      const pose = flightPose(index, second);
      return {
        deviceId: aircraft.id,
        timestamp: this.epochMilliseconds + second * 1000,
        longitude: pose.longitude,
        latitude: pose.latitude,
        altitudeMeters: pose.heightMeters,
        altitudeReference: "AGL",
        headingDegrees: ((pose.heading * 180) / Math.PI + 360) % 360,
        speedMetersPerSecond: pose.speed,
      };
    });
  }
  initialReports(): AircraftPositionReport[] {
    return Array.from({ length: 21 }, (_, index) =>
      this.reportsAt(index - 20),
    ).flat();
  }
  advance(elapsedSeconds: number): AircraftPositionReport[] {
    const second = Math.floor(elapsedSeconds);
    if (second <= this.lastSecond) return [];
    const reports: AircraftPositionReport[] = [];
    for (
      let time = Math.max(
        this.lastSecond + 1,
        second - MAX_REPORTS_PER_AIRCRAFT + 1,
      );
      time <= second;
      time++
    )
      reports.push(...this.reportsAt(time));
    this.lastSecond = second;
    return reports;
  }
}

export function reportCount(snapshot: AircraftReportSnapshot): number {
  let total = 0;
  snapshot.forEach((track) => {
    total += track.reports.length;
  });
  return total;
}
