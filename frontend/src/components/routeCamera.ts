export type RoutePoint = [number, number];

const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
export const ROUTE_CLOSEUP_PITCH = 60;

function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  const radians = Math.PI / 180;
  const latitude = ((a[1] + b[1]) / 2) * radians;
  return Math.hypot((b[0] - a[0]) * Math.cos(latitude), b[1] - a[1]) * 111_195;
}

function heading(a: RoutePoint, b: RoutePoint): number {
  const radians = Math.PI / 180;
  const latitude = ((a[1] + b[1]) / 2) * radians;
  return (
    (Math.atan2((b[0] - a[0]) * Math.cos(latitude), b[1] - a[1]) * 180) /
    Math.PI
  );
}

/** Frame a real-height waypoint at street scale, never the whole multi-kilometre route. */
export function routeCloseupCamera(
  points: RoutePoint[],
  heightMeters: number[] = [],
  selectedIndex: number | null = null,
  viewport = { width: 1000, height: 600 },
) {
  if (!points.length) return null;
  const index =
    selectedIndex !== null && points[selectedIndex] ? selectedIndex : 0;
  const point = points[index];
  if (!point.every(Number.isFinite)) return null;
  const neighborIndices = [index - 1, index + 1].filter(
    (candidate) => points[candidate],
  );
  const neighborRadius = Math.min(
    220,
    Math.max(50, ((viewport.width || 1000) - 120) / 3),
  );
  const closeIndices = neighborIndices.filter(
    (candidate) => distanceMeters(point, points[candidate]) <= neighborRadius,
  );
  const local = [index, ...closeIndices];
  const center = local.reduce<RoutePoint>(
    (sum, candidate) => [
      sum[0] + points[candidate][0] / local.length,
      sum[1] + points[candidate][1] / local.length,
    ],
    [0, 0],
  );
  const adjacent = points[index + 1] || points[index - 1];
  const segmentHeading = adjacent
    ? index + 1 < points.length
      ? heading(point, adjacent)
      : heading(adjacent, point)
    : 20;
  // Looking diagonally across the segment exposes its vertical stems and ground path.
  const bearing = ((segmentHeading - 40 + 540) % 360) - 180;
  const height = Math.max(260, viewport.height || 600);
  const offset: [number, number] = [
    0,
    Math.round(height * (height < 500 ? 0.32 : 0.17)),
  ];
  const tallest = Math.max(
    ...local.map((candidate) => {
      const altitude = heightMeters[candidate];
      return Number.isFinite(altitude) && altitude >= 0 ? altitude : 100;
    }),
    1,
  );
  // The perspective camera can magnify a near-side AGL stem beyond its
  // orthographic metre/pixel estimate, especially in a short embedded map.
  // Reserve the map's top toolbar and place the ground below the visual centre.
  // Tall planned routes lower camera zoom; their stored/rendered altitude stays real.
  const usableRise =
    Math.max(75, height * 0.67 - 56) / (height < 500 ? 1.4 : 1.1);
  const latitudeScale = Math.cos((center[1] * Math.PI) / 180);
  const heightZoom = Math.log2(
    (usableRise * EARTH_CIRCUMFERENCE_METERS * latitudeScale) /
      (512 * tallest * Math.sin((ROUTE_CLOSEUP_PITCH * Math.PI) / 180)),
  );
  return {
    center,
    zoom: Math.min(17.2, Math.max(11, heightZoom)),
    pitch: ROUTE_CLOSEUP_PITCH,
    bearing,
    offset,
    duration: 450,
  };
}
