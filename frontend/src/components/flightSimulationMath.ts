export const FLIGHT_CENTER: [number, number] = [120.173, 30.235];
export const FLIGHT_LAYER_ID = "command-aircraft-3d";

export type AircraftDefinition = {
  id: string;
  name: string;
  kind: "multirotor" | "fixed-wing";
  color: [number, number, number];
  period: number;
  phase: number;
};

export const AIRCRAFT: readonly AircraftDefinition[] = [
  {
    id: "patrol-01",
    name: "巡查 01",
    kind: "multirotor",
    color: [0.2, 0.93, 1],
    period: 110,
    phase: 0.35,
  },
  {
    id: "river-02",
    name: "江面 02",
    kind: "multirotor",
    color: [0.32, 1, 0.69],
    period: 130,
    phase: 1.7,
  },
  {
    id: "cargo-03",
    name: "城配 03",
    kind: "fixed-wing",
    color: [0.36, 0.76, 0.98],
    period: 150,
    phase: 3.35,
  },
  {
    id: "rescue-04",
    name: "应急 04",
    kind: "fixed-wing",
    color: [0.45, 0.83, 0.78],
    period: 125,
    phase: 5.1,
  },
];

export type FlightPose = {
  longitude: number;
  latitude: number;
  east: number;
  north: number;
  heightMeters: number;
  heading: number;
  pitch: number;
  bank: number;
  speed: number;
};

function routePoint(index: number, seconds: number) {
  const aircraft = AIRCRAFT[index] || AIRCRAFT[0];
  const angle = (seconds / aircraft.period) * Math.PI * 2 + aircraft.phase;
  switch (index) {
    case 1:
      return {
        east: 310 + 300 * Math.sin(angle),
        north: 40 + 210 * Math.sin(angle * 2),
        heightMeters: 320 + 100 * Math.sin(angle + 0.3),
      };
    case 2:
      return {
        east: -35 + 660 * Math.cos(angle),
        north: -30 + 390 * Math.sin(angle),
        heightMeters: 200 + 80 * Math.sin(angle * 2 + 0.4),
      };
    case 3:
      return {
        east: 40 + 560 * Math.cos(angle) + 40 * Math.cos(angle * 3),
        north: 15 + 350 * Math.sin(angle),
        heightMeters: 300 + 85 * Math.sin(angle + 0.8),
      };
    default:
      return {
        east: -350 + 310 * Math.cos(angle),
        north: 55 + 230 * Math.sin(angle),
        heightMeters: 205 + 65 * Math.sin(angle + 0.5),
      };
  }
}

/** All route coordinates are metres about one WGS84 anchor; height is AGL. */
export function flightPose(index: number, seconds: number): FlightPose {
  const time = Number.isFinite(seconds) ? seconds : 0;
  const point = routePoint(index, time);
  const before = routePoint(index, time - 0.05);
  const after = routePoint(index, time + 0.05);
  const eastVelocity = (after.east - before.east) / 0.1;
  const northVelocity = (after.north - before.north) / 0.1;
  const climb = (after.heightMeters - before.heightMeters) / 0.1;
  const speed = Math.hypot(eastVelocity, northVelocity);
  const earlier = routePoint(index, time - 0.15);
  const later = routePoint(index, time + 0.15);
  const previousHeading = Math.atan2(
    point.east - earlier.east,
    point.north - earlier.north,
  );
  const nextHeading = Math.atan2(
    later.east - point.east,
    later.north - point.north,
  );
  const turn =
    Math.atan2(
      Math.sin(nextHeading - previousHeading),
      Math.cos(nextHeading - previousHeading),
    ) / 0.15;
  const maxBank = index < 2 ? 0.18 : 0.52;
  return {
    ...point,
    longitude:
      FLIGHT_CENTER[0] +
      point.east / (111_195 * Math.cos((FLIGHT_CENTER[1] * Math.PI) / 180)),
    latitude: FLIGHT_CENTER[1] + point.north / 111_195,
    heading: Math.atan2(eastVelocity, northVelocity),
    pitch: Math.max(-0.3, Math.min(0.3, Math.atan2(climb, speed))),
    bank: Math.max(-maxBank, Math.min(maxBank, Math.atan2(speed * turn, 9.81))),
    speed,
  };
}

/** A paused or background clock has no anchor, so resuming cannot jump forward. */
export class FlightClock {
  seconds = 0;
  private lastTimestamp: number | null = null;
  reset() {
    this.seconds = 0;
    this.lastTimestamp = null;
  }
  suspend() {
    this.lastTimestamp = null;
  }
  advance(timestamp: number) {
    if (!Number.isFinite(timestamp)) return this.seconds;
    if (this.lastTimestamp !== null)
      this.seconds += Math.max(0, (timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = timestamp;
    return this.seconds;
  }
}

export type Point3 = { x: number; y: number; z: number };

export function orientAircraft(
  point: Point3,
  pose: Pick<FlightPose, "heading" | "pitch" | "bank">,
): Point3 {
  const bankCos = Math.cos(pose.bank),
    bankSin = Math.sin(pose.bank);
  const x = point.x * bankCos + point.z * bankSin;
  const bankZ = -point.x * bankSin + point.z * bankCos;
  const pitchCos = Math.cos(pose.pitch),
    pitchSin = Math.sin(pose.pitch);
  const y = point.y * pitchCos - bankZ * pitchSin;
  const z = point.y * pitchSin + bankZ * pitchCos;
  return {
    x: x * Math.cos(pose.heading) + y * Math.sin(pose.heading),
    y: -x * Math.sin(pose.heading) + y * Math.cos(pose.heading),
    z,
  };
}

/** Project real world Z with the map camera, retaining the NDC depth for terrain occlusion. */
export function projectFlightPoint(
  matrix: ArrayLike<number>,
  point: Point3,
): Point3 | null {
  const { x, y, z } = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(w) || w <= 0) return null;
  const projected = {
    x: (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    y: (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    z: (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  };
  return Object.values(projected).every(Number.isFinite) &&
    projected.z >= -1 &&
    projected.z <= 1
    ? projected
    : null;
}
