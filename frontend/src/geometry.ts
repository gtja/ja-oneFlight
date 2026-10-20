export type GeometryPosition = [number, number, ...number[]];
export type GeometryMode = "ROUTE" | "AIRSPACE";
export type DrawGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Polygon"; coordinates: number[][][] };

export interface GeometryBuildingAssociation {
  waypointIndex: number;
  id: string;
  name: string;
  heightMeters: number | null;
  center: [number, number];
  source: string;
  outline?: [number, number][];
}
/** Local route planning heights above each waypoint's terrain, never source Z. */
export interface RouteFlightProfile {
  reference: "AGL";
  defaultHeightMeters: number;
  waypointHeightsMeters: number[];
}

export const DEFAULT_ROUTE_HEIGHT_METERS = 100;
export const MAX_ROUTE_HEIGHT_METERS = 10_000;

export interface GeometryContext {
  version: 1;
  buildings: GeometryBuildingAssociation[];
  flightProfile?: RouteFlightProfile;
}

export function isRouteHeightMeters(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_ROUTE_HEIGHT_METERS
  );
}

function routeProfile(raw: unknown): RouteFlightProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Partial<RouteFlightProfile>;
  // An unknown source altitude reference must never silently become AGL.
  if (input.reference !== "AGL") return undefined;
  const defaultHeightMeters = isRouteHeightMeters(input.defaultHeightMeters)
    ? input.defaultHeightMeters
    : DEFAULT_ROUTE_HEIGHT_METERS;
  return {
    reference: "AGL",
    defaultHeightMeters,
    waypointHeightsMeters: Array.isArray(input.waypointHeightsMeters)
      ? input.waypointHeightsMeters.map((height) =>
          isRouteHeightMeters(height) ? height : defaultHeightMeters,
        )
      : [],
  };
}

/** Resize local planning values; new waypoints inherit the explicit default. */
export function resizeRouteFlightProfile(
  profile: RouteFlightProfile,
  pointCount: number,
): RouteFlightProfile {
  const normalized = routeProfile(profile) ?? {
    reference: "AGL" as const,
    defaultHeightMeters: DEFAULT_ROUTE_HEIGHT_METERS,
    waypointHeightsMeters: [],
  };
  const count =
    Number.isSafeInteger(pointCount) && pointCount > 0 ? pointCount : 0;
  return {
    ...normalized,
    waypointHeightsMeters: Array.from(
      { length: count },
      (_, index) =>
        normalized.waypointHeightsMeters[index] ??
        normalized.defaultHeightMeters,
    ),
  };
}

/** Initialize a draft profile separately from geometry and source altitude. */
export function ensureRouteFlightProfile(
  context: unknown,
  pointCount: number,
): GeometryContext & { flightProfile: RouteFlightProfile } {
  const normalized = sanitizeGeometryContext(context, pointCount);
  return {
    ...normalized,
    flightProfile: resizeRouteFlightProfile(
      normalized.flightProfile ?? {
        reference: "AGL",
        defaultHeightMeters: DEFAULT_ROUTE_HEIGHT_METERS,
        waypointHeightsMeters: [],
      },
      pointCount,
    ),
  };
}

export function setRouteWaypointHeight(
  profile: RouteFlightProfile,
  index: number,
  heightMeters: number,
): RouteFlightProfile {
  const next = resizeRouteFlightProfile(
    profile,
    profile.waypointHeightsMeters.length,
  );
  if (
    Number.isInteger(index) &&
    index >= 0 &&
    index < next.waypointHeightsMeters.length &&
    isRouteHeightMeters(heightMeters)
  )
    next.waypointHeightsMeters[index] = heightMeters;
  return next;
}

/** Apply the same local planning height and use it for subsequently drawn points. */
export function setRouteFlightHeight(
  profile: RouteFlightProfile,
  heightMeters: number,
): RouteFlightProfile {
  const next = resizeRouteFlightProfile(
    profile,
    profile.waypointHeightsMeters.length,
  );
  return isRouteHeightMeters(heightMeters)
    ? {
        reference: "AGL",
        defaultHeightMeters: heightMeters,
        waypointHeightsMeters: next.waypointHeightsMeters.map(
          () => heightMeters,
        ),
      }
    : next;
}

function parsedGeometry(raw: unknown): DrawGeometry | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") return null;
    const candidate = value as DrawGeometry;
    return (candidate.type === "LineString" || candidate.type === "Polygon") &&
      Array.isArray(candidate.coordinates)
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function validPosition(point: unknown): point is GeometryPosition {
  return (
    Array.isArray(point) &&
    point.length >= 2 &&
    point.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    ) &&
    Math.abs(point[0]) <= 180 &&
    Math.abs(point[1]) <= 90
  );
}

function sameLocation(a: GeometryPosition, b: GeometryPosition): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Keep source altitude/additional dimensions when preparing geometry for editing. */
export function geometryPositions(
  raw: unknown,
  mode: GeometryMode,
): GeometryPosition[] {
  const geometry = parsedGeometry(raw);
  if (!geometry) return [];
  const points =
    geometry.type === "Polygon"
      ? geometry.coordinates[0]
      : geometry.coordinates;
  if (!Array.isArray(points)) return [];
  const valid = points
    .filter(validPosition)
    .map((point) => [...point] as GeometryPosition);
  if (
    mode === "AIRSPACE" &&
    valid.length > 1 &&
    sameLocation(valid[0], valid.at(-1)!)
  )
    valid.pop();
  return valid;
}

/** Backwards-compatible map coordinates; editors should use geometryPositions. */
export function geometryPoints(
  raw: unknown,
  mode: GeometryMode,
): [number, number][] {
  return geometryPositions(raw, mode).map((point) => [point[0], point[1]]);
}

export function updateGeometryPoint(
  points: readonly GeometryPosition[],
  index: number,
  point: [number, number],
): GeometryPosition[] {
  return points.map((current, currentIndex) =>
    currentIndex === index && validPosition(point)
      ? [point[0], point[1], ...current.slice(2)]
      : [...current],
  );
}

export function removeGeometryPoint(
  points: readonly GeometryPosition[],
  index: number,
): GeometryPosition[] {
  return points
    .filter((_, pointIndex) => pointIndex !== index)
    .map((point) => [...point] as GeometryPosition);
}

/** Horizontal geodesic distance in metres; unknown altitude is never fabricated. */
export function routeLengthMeters(points: readonly GeometryPosition[]): number {
  const radians = Math.PI / 180;
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1],
      current = points[index];
    if (!validPosition(previous) || !validPosition(current)) continue;
    const latitude = (current[1] - previous[1]) * radians;
    const longitude = (current[0] - previous[0]) * radians;
    const arc =
      Math.sin(latitude / 2) ** 2 +
      Math.cos(previous[1] * radians) *
        Math.cos(current[1] * radians) *
        Math.sin(longitude / 2) ** 2;
    distance +=
      2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, arc))));
  }
  return distance;
}

/** Replace the editable outer ring while retaining valid source interior rings. */
export function drawGeometry(
  points: readonly GeometryPosition[],
  mode: GeometryMode,
  source?: unknown,
): DrawGeometry | null {
  if (points.some((point) => !validPosition(point))) return null;
  const copied = points.map((point) => [...point]);
  if (mode === "AIRSPACE") {
    if (
      copied.length > 1 &&
      sameLocation(
        copied[0] as GeometryPosition,
        copied.at(-1)! as GeometryPosition,
      )
    )
      copied.pop();
    if (copied.length < 3) return null;
    const original = parsedGeometry(source);
    const interiors =
      original?.type === "Polygon"
        ? original.coordinates
            .slice(1)
            .filter((ring) => Array.isArray(ring) && ring.every(validPosition))
            .map((ring) => ring.map((point) => [...point]))
        : [];
    return {
      type: "Polygon",
      coordinates: [[...copied, [...copied[0]]], ...interiors],
    };
  }
  return copied.length >= 2
    ? { type: "LineString", coordinates: copied }
    : null;
}

/** Keep associations separate from GeoJSON and drop stale waypoint references. */
export function sanitizeGeometryContext(
  context: unknown,
  pointCount: number,
): GeometryContext {
  const profile = routeProfile(
    context && typeof context === "object"
      ? (context as { flightProfile?: unknown }).flightProfile
      : undefined,
  );
  const input =
    context && typeof context === "object"
      ? (context as { buildings?: unknown }).buildings
      : undefined;
  const buildings: GeometryBuildingAssociation[] = [];
  if (Array.isArray(input)) {
    for (const value of input) {
      if (!value || typeof value !== "object") continue;
      const building = value as GeometryBuildingAssociation;
      if (
        !Number.isInteger(building.waypointIndex) ||
        building.waypointIndex < 0 ||
        building.waypointIndex >= pointCount ||
        typeof building.id !== "string" ||
        !building.id ||
        typeof building.source !== "string" ||
        !building.source ||
        !validPosition(building.center)
      )
        continue;
      // One building selection per waypoint. The latest selection replaces the old one.
      const previousIndex = buildings.findIndex(
        (item) => item.waypointIndex === building.waypointIndex,
      );
      if (previousIndex >= 0) buildings.splice(previousIndex, 1);
      buildings.push({
        waypointIndex: building.waypointIndex,
        id: building.id,
        name: typeof building.name === "string" ? building.name : "未命名建筑",
        heightMeters:
          typeof building.heightMeters === "number" &&
          Number.isFinite(building.heightMeters) &&
          building.heightMeters >= 0
            ? building.heightMeters
            : null,
        center: [building.center[0], building.center[1]],
        source: building.source,
        ...(Array.isArray(building.outline) &&
        building.outline.length >= 4 &&
        building.outline.every(validPosition) &&
        sameLocation(building.outline[0], building.outline.at(-1)!)
          ? {
              outline: building.outline.map((point): [number, number] => [
                point[0],
                point[1],
              ]),
            }
          : {}),
      });
    }
  }
  return {
    version: 1,
    buildings,
    ...(profile
      ? {
          flightProfile: {
            ...profile,
            waypointHeightsMeters: profile.waypointHeightsMeters.slice(
              0,
              Math.max(0, pointCount),
            ),
          },
        }
      : {}),
  };
}

export function removeGeometryAssociation(
  context: unknown,
  index: number,
): GeometryContext {
  const normalized = sanitizeGeometryContext(context, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(index) || index < 0) return normalized;
  return {
    ...normalized,
    buildings: normalized.buildings
      .filter((building) => building.waypointIndex !== index)
      .map((building) => ({
        ...building,
        waypointIndex:
          building.waypointIndex > index
            ? building.waypointIndex - 1
            : building.waypointIndex,
      })),
    ...(normalized.flightProfile
      ? {
          flightProfile: {
            ...normalized.flightProfile,
            waypointHeightsMeters:
              normalized.flightProfile.waypointHeightsMeters.filter(
                (_, pointIndex) => pointIndex !== index,
              ),
          },
        }
      : {}),
  };
}
