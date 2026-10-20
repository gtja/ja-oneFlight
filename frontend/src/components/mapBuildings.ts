import type { Feature, Polygon, Position } from "geojson";

export const BUILDING_SOURCE_URL =
  import.meta.env.VITE_BUILDING_SOURCE_URL ||
  "https://tiles.openfreemap.org/planet";
export const BUILDING_SOURCE_ID = "context-buildings";
export const BUILDING_LAYER_IDS = [
  "context-buildings-2d",
  "context-buildings-3d",
];

export type MapBuilding = {
  id: string;
  name: string;
  heightMeters: number | null;
  center: [number, number];
  source: string;
  outline?: [number, number][];
};

function ringContains(point: [number, number], ring: Position[]): boolean {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const a = ring[index],
      b = ring[previous];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function ringDistance(point: [number, number], ring: Position[]): number {
  const scale = Math.cos((point[1] * Math.PI) / 180);
  let nearest = Infinity;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index],
      next = ring[(index + 1) % ring.length];
    const x = (current[0] - point[0]) * scale,
      y = current[1] - point[1];
    const dx = (next[0] - current[0]) * scale,
      dy = next[1] - current[1];
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(0, Math.min(1, -(x * dx + y * dy) / length))
      : 0;
    nearest = Math.min(nearest, (x + t * dx) ** 2 + (y + t * dy) ** 2);
  }
  return nearest;
}
/** Isolate the clicked physical outline when a vector feature groups multiple buildings. */
export function buildingPolygon(
  feature: Feature,
  clickLngLat?: [number, number],
): Polygon | null {
  const geometry = feature.geometry;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  const valid = polygons.filter(
    (rings) =>
      rings[0]?.length >= 3 &&
      rings[0].every(
        (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
      ),
  );
  if (!valid.length) return null;
  let selected = valid[0];
  if (clickLngLat) {
    selected =
      valid.find(
        (rings) =>
          ringContains(clickLngLat, rings[0]) &&
          !rings.slice(1).some((ring) => ringContains(clickLngLat, ring)),
      ) ||
      [...valid].sort(
        (a, b) =>
          ringDistance(clickLngLat, a[0]) - ringDistance(clickLngLat, b[0]),
      )[0];
  }
  return {
    type: "Polygon",
    coordinates: selected.map((ring) => ring.map((point) => [...point])),
  };
}
/** The ID is independent of feature order, ring start vertex and winding direction. */
function outlineHash(ring: Position[]): string {
  const vertices = ring.map(
    (point) => `${point[0].toFixed(7)},${point[1].toFixed(7)}`,
  );
  if (vertices.length > 1 && vertices[0] === vertices.at(-1)) vertices.pop();
  const canonical = (points: string[]) => {
    let first = 0;
    for (let index = 1; index < points.length; index++)
      if (points[index] < points[first]) first = index;
    return [...points.slice(first), ...points.slice(0, first)].join(";");
  };
  const text = [
    canonical(vertices),
    canonical([...vertices].reverse()),
  ].sort()[0];
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++)
    hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Provider render_height may be a floor estimate/default; never persist it as measured height. */
export function buildingFromFeature(
  feature: Feature,
  clickLngLat?: [number, number],
): MapBuilding | null {
  const polygon = buildingPolygon(feature, clickLngLat);
  if (!polygon) return null;
  const outline = polygon.coordinates[0].map(
    (point) => [point[0], point[1]] as [number, number],
  );
  if (
    outline[0][0] !== outline.at(-1)![0] ||
    outline[0][1] !== outline.at(-1)![1]
  )
    outline.push([...outline[0]]);
  const longitudes = outline.map((point) => point[0]);
  const latitudes = outline.map((point) => point[1]);
  const center: [number, number] = [
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
  ];
  const properties = feature.properties || {};
  const height = properties.height;
  const measured =
    height !== null && height !== undefined && height !== ""
      ? Number(height)
      : NaN;
  const sourceId = String(feature.id ?? "outline");
  const id = `${sourceId}:polygon:${outlineHash(outline)}`;
  return {
    id,
    name: String(
      properties["name:zh"] || properties.name || `未命名楼宇 · #${sourceId}`,
    ),
    heightMeters: Number.isFinite(measured) && measured >= 0 ? measured : null,
    center,
    outline,
    source: BUILDING_SOURCE_URL.startsWith("https://tiles.openfreemap.org/")
      ? "OpenFreeMap / OpenStreetMap"
      : BUILDING_SOURCE_URL,
  };
}
