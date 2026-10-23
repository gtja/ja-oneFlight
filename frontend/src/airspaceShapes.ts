import type { GeometryPosition } from "./geometry";

export type AirspaceShape =
  | { type: "CIRCLE"; center: [number, number]; radiusMeters: number }
  | {
      type: "RECTANGLE";
      west: number;
      south: number;
      east: number;
      north: number;
    };

const EARTH_RADIUS_METERS = 6_371_008.8;
const RADIANS = Math.PI / 180;
const FULL_TURN = 2 * Math.PI;
const DEFAULT_CIRCLE_POINTS = 64;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validLocation(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(finiteNumber) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

/** Reject circles whose Polygon representation would cross a pole or date line. */
export function sanitizeAirspaceShape(raw: unknown): AirspaceShape | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, unknown>;
  if (input.type === "CIRCLE") {
    if (
      !validLocation(input.center) ||
      !finiteNumber(input.radiusMeters) ||
      input.radiusMeters <= 0
    )
      return undefined;
    const [longitude, latitude] = input.center;
    const angularRadius = input.radiusMeters / EARTH_RADIUS_METERS;
    if (angularRadius >= Math.PI / 2 - Math.abs(latitude * RADIANS))
      return undefined;
    const longitudeRadius =
      Math.asin(Math.sin(angularRadius) / Math.cos(latitude * RADIANS)) /
      RADIANS;
    if (
      longitude - longitudeRadius <= -180 ||
      longitude + longitudeRadius >= 180
    )
      return undefined;
    return {
      type: "CIRCLE",
      center: [longitude, latitude],
      radiusMeters: input.radiusMeters,
    };
  }
  if (input.type === "RECTANGLE") {
    const { west, south, east, north } = input;
    if (
      !finiteNumber(west) ||
      !finiteNumber(south) ||
      !finiteNumber(east) ||
      !finiteNumber(north) ||
      west < -180 ||
      east > 180 ||
      south < -90 ||
      north > 90 ||
      west >= east ||
      south >= north
    )
      return undefined;
    return { type: "RECTANGLE", west, south, east, north };
  }
  return undefined;
}

function openPoints(
  points: readonly GeometryPosition[],
): readonly GeometryPosition[] {
  const last = points.at(-1);
  return points.length > 1 &&
    last?.[0] === points[0][0] &&
    last[1] === points[0][1]
    ? points.slice(0, -1)
    : points;
}

function distanceMeters(
  first: readonly [number, number],
  second: readonly [number, number],
): number {
  const latitude = (second[1] - first[1]) * RADIANS;
  const longitude = (second[0] - first[0]) * RADIANS;
  const arc =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(first[1] * RADIANS) *
      Math.cos(second[1] * RADIANS) *
      Math.sin(longitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, arc)));
}

function bearing(
  center: readonly [number, number],
  point: readonly number[],
): number {
  const latitude = center[1] * RADIANS;
  const targetLatitude = point[1] * RADIANS;
  const longitude = (point[0] - center[0]) * RADIANS;
  return Math.atan2(
    Math.sin(longitude) * Math.cos(targetLatitude),
    Math.cos(latitude) * Math.sin(targetLatitude) -
      Math.sin(latitude) * Math.cos(targetLatitude) * Math.cos(longitude),
  );
}

function destination(
  center: readonly [number, number],
  radiusMeters: number,
  direction: number,
): [number, number] {
  const latitude = center[1] * RADIANS;
  const angularRadius = radiusMeters / EARTH_RADIUS_METERS;
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angularRadius) +
      Math.cos(latitude) * Math.sin(angularRadius) * Math.cos(direction),
  );
  const targetLongitude =
    center[0] * RADIANS +
    Math.atan2(
      Math.sin(direction) * Math.sin(angularRadius) * Math.cos(latitude),
      Math.cos(angularRadius) - Math.sin(latitude) * Math.sin(targetLatitude),
    );
  return [targetLongitude / RADIANS, targetLatitude / RADIANS];
}

function sphereVector(point: readonly number[]): [number, number, number] {
  const latitude = point[1] * RADIANS;
  const longitude = point[0] * RADIANS;
  return [
    Math.cos(latitude) * Math.cos(longitude),
    Math.cos(latitude) * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

/** Recognize existing geometry without rewriting its coordinates or dimensions. */
export function inferAirspaceShape(
  originalPoints: readonly GeometryPosition[],
): AirspaceShape | undefined {
  if (originalPoints.some((point) => !validLocation(point))) return undefined;
  const points = openPoints(originalPoints);
  if (points.length === 4) {
    const west = Math.min(...points.map((point) => point[0]));
    const east = Math.max(...points.map((point) => point[0]));
    const south = Math.min(...points.map((point) => point[1]));
    const north = Math.max(...points.map((point) => point[1]));
    const corners = new Set(points.map((point) => `${point[0]},${point[1]}`));
    if (
      corners.size === 4 &&
      points.every(
        (point, index) =>
          (point[0] === west || point[0] === east) &&
          (point[1] === south || point[1] === north) &&
          (point[0] === points[(index + 1) % 4][0] ||
            point[1] === points[(index + 1) % 4][1]),
      )
    )
      return sanitizeAirspaceShape({
        type: "RECTANGLE",
        west,
        south,
        east,
        north,
      });
    return undefined;
  }
  if (points.length < 16) return undefined;

  // A geodesic circle lies in a plane on the unit sphere. Three well-separated
  // samples determine its normal without a latitude-dependent map projection.
  const first = sphereVector(points[0]);
  const second = sphereVector(points[Math.floor(points.length / 3)]);
  const third = sphereVector(points[Math.floor((2 * points.length) / 3)]);
  const a = second.map((value, index) => value - first[index]);
  const b = third.map((value, index) => value - first[index]);
  const normal = [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const length = Math.hypot(...normal);
  if (length === 0) return undefined;
  const direction =
    normal.reduce((total, value, index) => total + value * first[index], 0) < 0
      ? -1
      : 1;
  const center: [number, number] = [
    Math.atan2(direction * normal[1], direction * normal[0]) / RADIANS,
    Math.asin(Math.max(-1, Math.min(1, (direction * normal[2]) / length))) /
      RADIANS,
  ];
  const radii = points.map((point) =>
    distanceMeters(center, [point[0], point[1]]),
  );
  const radiusMeters =
    radii.reduce((sum, radius) => sum + radius, 0) / radii.length;
  const shape = sanitizeAirspaceShape({ type: "CIRCLE", center, radiusMeters });
  if (
    !shape ||
    radii.some(
      (radius) =>
        Math.abs(radius - radiusMeters) > Math.max(0.001, radiusMeters * 0.005),
    )
  )
    return undefined;

  const bearings = points.map((point) => bearing(center, point));
  let winding = 0;
  let previousDirection = 0;
  for (let index = 0; index < bearings.length; index += 1) {
    const difference =
      bearings[(index + 1) % bearings.length] - bearings[index];
    const turn = ((difference + 3 * Math.PI) % FULL_TURN) - Math.PI;
    if (
      Math.abs(turn) < 1e-8 ||
      Math.abs(turn) > Math.PI / 2 ||
      (previousDirection !== 0 && Math.sign(turn) !== previousDirection)
    )
      return undefined;
    previousDirection = Math.sign(turn);
    winding += turn;
  }
  return Math.abs(Math.abs(winding) - FULL_TURN) < 1e-6 ? shape : undefined;
}

/** Return an open outer ring; drawGeometry remains responsible for its closure. */
export function airspaceShapePoints(
  raw: AirspaceShape,
  originalPoints?: readonly GeometryPosition[],
): GeometryPosition[] {
  const shape = sanitizeAirspaceShape(raw);
  if (!shape || originalPoints?.some((point) => !validLocation(point)))
    return [];
  const original = originalPoints ? openPoints(originalPoints) : [];
  const previous = inferAirspaceShape(original);
  if (shape.type === "CIRCLE") {
    const matching = previous?.type === "CIRCLE";
    const count = matching ? original.length : DEFAULT_CIRCLE_POINTS;
    return Array.from({ length: count }, (_, index): GeometryPosition => {
      const direction = matching
        ? bearing(previous.center, original[index])
        : (index * FULL_TURN) / count;
      const point = destination(shape.center, shape.radiusMeters, direction);
      return [...point, ...(matching ? original[index].slice(2) : [])];
    });
  }
  if (previous?.type === "RECTANGLE") {
    return original.map((point): GeometryPosition => [
      point[0] === previous.west ? shape.west : shape.east,
      point[1] === previous.south ? shape.south : shape.north,
      ...point.slice(2),
    ]);
  }
  return [
    [shape.west, shape.south],
    [shape.east, shape.south],
    [shape.east, shape.north],
    [shape.west, shape.north],
  ];
}

export function airspaceShapeHandles(raw: AirspaceShape): [number, number][] {
  const shape = sanitizeAirspaceShape(raw);
  if (!shape) return [];
  return shape.type === "CIRCLE"
    ? [shape.center, destination(shape.center, shape.radiusMeters, Math.PI / 2)]
    : [
        [shape.west, shape.south],
        [shape.east, shape.north],
      ];
}

export function moveAirspaceShape(
  raw: AirspaceShape,
  index: number,
  location: readonly [number, number],
): AirspaceShape | undefined {
  const shape = sanitizeAirspaceShape(raw);
  if (!shape || !validLocation(location) || (index !== 0 && index !== 1))
    return undefined;
  if (shape.type === "CIRCLE")
    return sanitizeAirspaceShape({
      ...shape,
      ...(index === 0
        ? { center: [location[0], location[1]] }
        : { radiusMeters: distanceMeters(shape.center, location) }),
    });
  const opposite =
    index === 0 ? [shape.east, shape.north] : [shape.west, shape.south];
  return sanitizeAirspaceShape({
    type: "RECTANGLE",
    west: Math.min(location[0], opposite[0]),
    south: Math.min(location[1], opposite[1]),
    east: Math.max(location[0], opposite[0]),
    north: Math.max(location[1], opposite[1]),
  });
}
