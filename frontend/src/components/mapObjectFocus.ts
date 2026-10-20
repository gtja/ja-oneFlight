import type { Geometry, Position } from "geojson";
import type { Entity } from "../api";

export type MapObjectLocation =
  | { point: [number, number] }
  | { bounds: [[number, number], [number, number]] };

function position(value: unknown): value is Position {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item)) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}

export function objectCoordinates(entity: Entity): [number, number] | null {
  const telemetry = (entity.telemetry ||
    entity.latestTelemetry ||
    {}) as Record<string, unknown>;
  const longitude = entity.longitude ?? telemetry.longitude;
  const latitude = entity.latitude ?? telemetry.latitude;
  // Empty strings and booleans are not observations of 0°, 0°.
  const numeric = (value: unknown) =>
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "");
  if (!numeric(longitude) || !numeric(latitude)) return null;
  const point = [Number(longitude), Number(latitude)];
  return position(point) ? [point[0], point[1]] : null;
}

function validGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== "object") return false;
  const geometry = value as Geometry;
  const line = (points: unknown, minimum: number): points is Position[] =>
    Array.isArray(points) && points.length >= minimum && points.every(position);
  const ring = (points: unknown) =>
    line(points, 4) &&
    points[0][0] === points.at(-1)![0] &&
    points[0][1] === points.at(-1)![1];
  const polygon = (rings: unknown): boolean =>
    Array.isArray(rings) && rings.length > 0 && rings.every(ring);
  switch (geometry.type) {
    case "Point":
      return position(geometry.coordinates);
    case "MultiPoint":
      return line(geometry.coordinates, 1);
    case "LineString":
      return line(geometry.coordinates, 2);
    case "MultiLineString":
      return (
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length > 0 &&
        geometry.coordinates.every((points) => line(points, 2))
      );
    case "Polygon":
      return polygon(geometry.coordinates);
    case "MultiPolygon":
      return (
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length > 0 &&
        geometry.coordinates.every(polygon)
      );
    case "GeometryCollection":
      return (
        Array.isArray(geometry.geometries) &&
        geometry.geometries.length > 0 &&
        geometry.geometries.every(validGeometry)
      );
    default:
      return false;
  }
}

/** Reject malformed saved geometry as a whole; never invent missing vertices. */
export function mapObjectGeometry(entity: Entity): Geometry | null {
  try {
    const metadata = entity.metadata as Record<string, unknown> | undefined;
    const raw = metadata?.geometry ?? entity.geometry;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const geometry = parsed?.type === "Feature" ? parsed.geometry : parsed;
    return validGeometry(geometry) ? geometry : null;
  } catch {
    return null;
  }
}

export function mapGeometryPoints(geometry: Geometry): [number, number][] {
  if (geometry.type === "GeometryCollection")
    return geometry.geometries.flatMap(mapGeometryPoints);
  const points: [number, number][] = [];
  const collect = (value: unknown) => {
    if (position(value)) points.push([value[0], value[1]]);
    else if (Array.isArray(value)) value.forEach(collect);
  };
  collect(geometry.coordinates);
  return points;
}

export function mapObjectLocation(entity: Entity): MapObjectLocation | null {
  const geometry = mapObjectGeometry(entity);
  const point = objectCoordinates(entity);
  if (point && !["ROUTE", "AIRSPACE"].includes(String(entity.kind)))
    return { point };
  if (geometry) {
    const points = mapGeometryPoints(geometry);
    const longitude = points.map(([x]) => x),
      latitude = points.map(([, y]) => y);
    const southwest: [number, number] = [
      Math.min(...longitude),
      Math.min(...latitude),
    ];
    const northeast: [number, number] = [
      Math.max(...longitude),
      Math.max(...latitude),
    ];
    if (southwest[0] === northeast[0] && southwest[1] === northeast[1])
      return { point: southwest };
    return { bounds: [southwest, northeast] };
  }
  return point ? { point } : null;
}

export function hasMapObjectLocation(entity: Entity): boolean {
  return mapObjectLocation(entity) !== null;
}
