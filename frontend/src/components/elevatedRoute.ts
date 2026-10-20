import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap,
  type ErrorEvent as MapErrorEvent,
} from "maplibre-gl";
import { DEFAULT_ROUTE_HEIGHT_METERS } from "../geometry";

export const ELEVATED_ROUTE_LAYER_ID = "drawing-route-elevated";
type Point = [number, number];
type Matrix = ArrayLike<number>;
type Color = [number, number, number, number];
export type ProjectedRoutePoint = {
  x: number;
  y: number;
  z: number;
};
export type ElevatedRouteDrawing = {
  points: Point[];
  heightMeters?: number[];
  showGroundProjection?: boolean;
  showCurtain?: boolean;
  showHeightLabels?: boolean;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onMove: (index: number, point: Point) => void;
  onTerrainStatus?: (status: { known: number; total: number }) => void;
};
type RouteVisualOptions = Pick<
  ElevatedRouteDrawing,
  "showGroundProjection" | "showCurtain"
>;
const interpolate = (
  a: ProjectedRoutePoint,
  b: ProjectedRoutePoint,
  t: number,
): ProjectedRoutePoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

/** Clip before tessellating dashes, so a horizon-crossing route cannot create unbounded geometry. */
export function visibleRouteSegment(
  a: ProjectedRoutePoint,
  b: ProjectedRoutePoint,
  marginX = 0,
  marginY = 0,
): [number, number] | null {
  if (![...Object.values(a), ...Object.values(b)].every(Number.isFinite))
    return null;
  let start = 0,
    end = 1;
  for (const [axis, margin] of [
    ["x", marginX],
    ["y", marginY],
    ["z", 0],
  ] as const) {
    const delta = b[axis] - a[axis],
      limit = 1 + margin;
    if (Math.abs(delta) < 1e-12) {
      if (Math.abs(a[axis]) > limit) return null;
      continue;
    }
    const t1 = (-limit - a[axis]) / delta,
      t2 = (limit - a[axis]) / delta;
    start = Math.max(start, Math.min(t1, t2));
    end = Math.min(end, Math.max(t1, t2));
    if (start > end) return null;
  }
  return [start, end];
}

/** Reserve labels in screen space; selected labels win and hidden labels leave handles interactive. */
export function routeLabelVisibility(
  labels: {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  }[],
  selected: number | null,
): boolean[] {
  const cells = new Map<string, number[]>(),
    visible = labels.map(() => false),
    cellSize = 80;
  const order = labels.map((_, index) => index);
  if (selected !== null && labels[selected]) {
    order.splice(selected, 1);
    order.unshift(selected);
  }
  for (const index of order) {
    const label = labels[index];
    if (!label.visible) continue;
    const keys: string[] = [];
    for (
      let x = Math.floor((label.x - 5) / cellSize);
      x <= Math.floor((label.x + label.width + 5) / cellSize);
      x++
    )
      for (
        let y = Math.floor((label.y - 5) / cellSize);
        y <= Math.floor((label.y + label.height + 5) / cellSize);
        y++
      )
        keys.push(`${x},${y}`);
    const collides = keys.some((key) =>
      cells.get(key)?.some((otherIndex) => {
        const other = labels[otherIndex];
        return (
          label.x < other.x + other.width + 5 &&
          label.x + label.width + 5 > other.x &&
          label.y < other.y + other.height + 5 &&
          label.y + label.height + 5 > other.y
        );
      }),
    );
    if (collides) continue;
    visible[index] = true;
    keys.forEach((key) => cells.set(key, [...(cells.get(key) || []), index]));
  }
  return visible;
}

/** Uses MapLibre's custom-layer camera matrix, including the world Z coordinate. */
export function projectRoutePosition(
  matrix: Matrix,
  coordinate: { x: number; y: number; z: number },
): ProjectedRoutePoint | null {
  const { x, y, z } = coordinate;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(w) || w <= 0) return null;
  const position = {
    x: (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    y: (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    z: (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  };
  return Object.values(position).every(Number.isFinite) && position.z >= -1
    ? position
    : null;
}
export function routeHeight(height: number | undefined): number {
  return typeof height === "number" && Number.isFinite(height) && height >= 0
    ? height
    : DEFAULT_ROUTE_HEIGHT_METERS;
}
export function resolveRouteElevation(
  terrainElevation: number | null,
  height: number | undefined,
): { ground: number; air: number; known: boolean } {
  const known = terrainElevation !== null && Number.isFinite(terrainElevation);
  const ground = known ? terrainElevation : 0;
  return { ground, air: ground + routeHeight(height), known };
}

/** Triangle strips use projected depth, retaining terrain/building occlusion. */
export function routeMesh(
  air: (ProjectedRoutePoint | null)[],
  ground: (ProjectedRoutePoint | null)[],
  width: number,
  height: number,
  selected: number | null,
  options: RouteVisualOptions = {},
): Float32Array {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return new Float32Array();
  const vertices: number[] = [],
    marginX = 32 / width,
    marginY = 32 / height;
  const vertex = (point: ProjectedRoutePoint, color: Color) =>
    vertices.push(point.x, point.y, point.z, ...color);
  const offset = (point: ProjectedRoutePoint, x: number, y: number) => ({
    x: point.x + (x * 2) / width,
    y: point.y + (y * 2) / height,
    z: point.z,
  });
  const triangle = (
    a: ProjectedRoutePoint,
    b: ProjectedRoutePoint,
    c: ProjectedRoutePoint,
    color: Color,
  ) => {
    vertex(a, color);
    vertex(b, color);
    vertex(c, color);
  };
  const line = (
    originalA: ProjectedRoutePoint,
    originalB: ProjectedRoutePoint,
    size: number,
    color: Color,
  ) => {
    const range = visibleRouteSegment(originalA, originalB, marginX, marginY);
    if (!range) return;
    const a = interpolate(originalA, originalB, range[0]),
      b = interpolate(originalA, originalB, range[1]);
    const dx = ((b.x - a.x) * width) / 2,
      dy = ((b.y - a.y) * height) / 2,
      length = Math.hypot(dx, dy);
    if (length < 0.01) return;
    const nx = ((-dy / length) * size) / 2,
      ny = ((dx / length) * size) / 2;
    const a1 = offset(a, nx, ny),
      a2 = offset(a, -nx, -ny),
      b1 = offset(b, nx, ny),
      b2 = offset(b, -nx, -ny);
    triangle(a1, a2, b1, color);
    triangle(a2, b2, b1, color);
  };
  const dashed = (
    a: ProjectedRoutePoint,
    b: ProjectedRoutePoint,
    dash: number,
    gap: number,
    draw: (start: ProjectedRoutePoint, end: ProjectedRoutePoint) => void,
  ) => {
    const range = visibleRouteSegment(a, b, marginX, marginY);
    if (!range) return;
    const visibleA = interpolate(a, b, range[0]),
      visibleB = interpolate(a, b, range[1]),
      length = Math.hypot(
        ((visibleB.x - visibleA.x) * width) / 2,
        ((visibleB.y - visibleA.y) * height) / 2,
      );
    if (length < 0.01) return;
    // Only the visible span is tessellated; this is bounded by the viewport diagonal.
    for (let pixel = 0; pixel < length; pixel += dash + gap)
      draw(
        interpolate(visibleA, visibleB, pixel / length),
        interpolate(
          visibleA,
          visibleB,
          Math.min(pixel + dash, length) / length,
        ),
      );
  };
  const circle = (
    point: ProjectedRoutePoint,
    radius: number,
    color: Color,
    inner = 0,
  ) => {
    if (
      Math.abs(point.x) > 1 + marginX ||
      Math.abs(point.y) > 1 + marginY ||
      Math.abs(point.z) > 1
    )
      return;
    for (let index = 0; index < 16; index++) {
      const a = (index * Math.PI) / 8,
        b = ((index + 1) * Math.PI) / 8,
        a1 = offset(point, Math.cos(a) * radius, Math.sin(a) * radius),
        b1 = offset(point, Math.cos(b) * radius, Math.sin(b) * radius);
      if (!inner) triangle(point, a1, b1, color);
      else {
        const a2 = offset(point, Math.cos(a) * inner, Math.sin(a) * inner),
          b2 = offset(point, Math.cos(b) * inner, Math.sin(b) * inner);
        triangle(a1, a2, b1, color);
        triangle(a2, b2, b1, color);
      }
    }
  };
  const curtain = (corners: ProjectedRoutePoint[], color: Color) => {
    let polygon = corners;
    // Clip the translucent quad in NDC; do not create huge near-camera triangles.
    for (const axis of ["x", "y", "z"] as const) {
      const limit = 1 + (axis === "x" ? marginX : axis === "y" ? marginY : 0);
      for (const direction of [-1, 1]) {
        const clipped: ProjectedRoutePoint[] = [];
        polygon.forEach((b, index) => {
          const a = polygon[(index + polygon.length - 1) % polygon.length],
            aInside = a[axis] * direction <= limit,
            bInside = b[axis] * direction <= limit;
          if (aInside !== bInside)
            clipped.push(
              interpolate(
                a,
                b,
                (limit * direction - a[axis]) / (b[axis] - a[axis]),
              ),
            );
          if (bInside) clipped.push(b);
        });
        polygon = clipped;
        if (!polygon.length) return;
      }
    }
    for (let index = 2; index < polygon.length; index++)
      triangle(polygon[0], polygon[index - 1], polygon[index], color);
  };
  // The curtain joins the real air and terrain positions; no visual height exaggeration.
  if (options.showCurtain !== false)
    for (let index = 1; index < air.length; index++) {
      const a = air[index - 1],
        b = air[index],
        ga = ground[index - 1],
        gb = ground[index];
      if (!a || !b || !ga || !gb) continue;
      curtain(
        [a, ga, gb, b],
        [
          0.1,
          0.91,
          0.69,
          selected === index || selected === index - 1 ? 0.13 : 0.075,
        ],
      );
    }
  // A muted dashed footprint separates the ground path from the solid airborne path.
  if (options.showGroundProjection !== false)
    for (let index = 1; index < ground.length; index++) {
      const a = ground[index - 1],
        b = ground[index];
      if (!a || !b) continue;
      dashed(a, b, 7, 6, (start, end) => {
        line(start, end, 4, [0.015, 0.07, 0.085, 0.8]);
        line(start, end, 1.7, [0.76, 0.89, 0.91, 0.7]);
      });
    }
  // White legs descend to each waypoint's actual terrain sample.
  air.forEach((point, index) => {
    const foot = ground[index];
    if (!point || !foot) return;
    dashed(point, foot, 5, 5, (start, end) => {
      line(start, end, 4.6, [0.015, 0.055, 0.065, 0.82]);
      line(start, end, 2.2, [1, 1, 1, 0.98]);
    });
    circle(foot, index === selected ? 7.5 : 6, [0.015, 0.055, 0.065, 0.9]);
    circle(
      foot,
      index === selected ? 6 : 4.7,
      index === selected ? [1, 0.79, 0.35, 1] : [0.94, 1, 1, 0.95],
      index === selected ? 4.3 : 3.2,
    );
    circle(foot, 2.1, [1, 1, 1, 1]);
  });
  for (let index = 1; index < air.length; index++) {
    const a = air[index - 1],
      b = air[index];
    if (!a || !b) continue;
    line(a, b, 10, [0.02, 0.95, 0.7, 0.12]);
    line(a, b, 7, [0.01, 0.12, 0.11, 0.92]);
    line(a, b, 4.5, [0.02, 0.96, 0.65, 1]);
    line(a, b, 1.1, [0.63, 1, 0.86, 0.88]);
  }
  air.forEach((point, index) => {
    if (
      !point ||
      Math.abs(point.x) > 1 + marginX ||
      Math.abs(point.y) > 1 + marginY ||
      Math.abs(point.z) > 1
    )
      return;
    const isSelected = index === selected;
    if (isSelected) circle(point, 19, [1, 0.76, 0.23, 0.26], 14);
    triangle(
      offset(point, -13, 10),
      offset(point, 13, 10),
      offset(point, 0, -14),
      [0.015, 0.07, 0.08, 0.95],
    );
    triangle(
      offset(point, -11, 8),
      offset(point, 11, 8),
      offset(point, 0, -12),
      isSelected ? [1, 0.79, 0.35, 1] : [0.94, 1, 0.98, 1],
    );
    triangle(
      offset(point, -8.4, 6.4),
      offset(point, 8.4, 6.4),
      offset(point, 0, -9),
      isSelected ? [0.89, 0.54, 0.12, 1] : [0.02, 0.8, 0.54, 1],
    );
  });
  return new Float32Array(vertices);
}

/** Inverts the altitude-aware camera projection; a ground-only unproject would shift dragged air waypoints. */
export function invertRoutePosition(
  start: Point,
  target: { x: number; y: number },
  project: (point: Point) => { x: number; y: number } | null,
): Point | null {
  const point: Point = [...start];
  for (let iteration = 0; iteration < 8; iteration++) {
    const current = project(point);
    const step = 0.00001;
    const px = project([point[0] + step, point[1]]);
    const py = project([point[0], point[1] + step]);
    if (!current || !px || !py) return null;
    const dx = target.x - current.x,
      dy = target.y - current.y;
    if (Math.hypot(dx, dy) < 0.1) return point;
    const a = (px.x - current.x) / step,
      b = (py.x - current.x) / step;
    const c = (px.y - current.y) / step,
      d = (py.y - current.y) / step;
    const determinant = a * d - b * c;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 0.000001)
      return null;
    point[0] += (dx * d - b * dy) / determinant;
    point[1] += (a * dy - dx * c) / determinant;
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > 85) return null;
  }
  const end = project(point);
  return end && Math.hypot(target.x - end.x, target.y - end.y) < 1
    ? point
    : null;
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;
export class ElevatedRouteLayer implements CustomLayerInterface {
  id = ELEVATED_ROUTE_LAYER_ID;
  type = "custom" as const;
  renderingMode = "3d" as const;
  private map?: LibreMap;
  private gl?: GL;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private overlay?: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];
  private latestMatrix?: number[];
  private terrainStatus = "";
  private terrainFailed = false;
  private terrainSamples = new Map<string, number>();
  private terrainError = (event: MapErrorEvent) => {
    if ("sourceId" in event && event.sourceId === "terrain") {
      this.terrainFailed = true;
      this.terrainSamples.clear();
    }
  };
  private cleanupDrag?: () => void;
  private dragPoint?: { index: number; point: Point };
  constructor(private drawing: ElevatedRouteDrawing) {}
  setDrawing(drawing: ElevatedRouteDrawing) {
    this.drawing = drawing;
    this.ensureButtons();
    this.map?.triggerRepaint();
  }
  onAdd(map: LibreMap, gl: GL) {
    this.map = map;
    this.gl = gl;
    map.on("error", this.terrainError);
    this.overlay = document.createElement("div");
    this.overlay.className = "route-elevated-overlay";
    this.overlay.dataset.routeElevated = "true";
    map.getContainer().append(this.overlay);
    this.ensureButtons();
  }
  private ensureButtons() {
    if (!this.overlay) return;
    while (this.buttons.length > this.drawing.points.length)
      this.buttons.pop()?.remove();
    while (this.buttons.length < this.drawing.points.length) {
      const index = this.buttons.length;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "route-elevated-waypoint";
      const label = document.createElement("span");
      label.className = "route-elevated-label";
      const number = document.createElement("b");
      number.textContent = String(index + 1);
      const altitude = document.createElement("em");
      altitude.className = "route-elevated-height";
      label.append(number, altitude);
      button.append(label);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.drawing.onSelect(index);
      });
      button.addEventListener("pointerdown", (event) =>
        this.beginDrag(event, index),
      );
      this.overlay.append(button);
      this.buttons.push(button);
    }
    this.buttons.forEach((button, index) => {
      const height = routeHeight(this.drawing.heightMeters?.[index]);
      button.setAttribute(
        "aria-label",
        `航点 ${index + 1}${index === 0 ? " · 起点" : index === this.buttons.length - 1 ? " · 终点" : ""}，离地 ${height} 米，可拖动调整`,
      );
      button.setAttribute(
        "aria-pressed",
        String(index === this.drawing.selectedIndex),
      );
      button.title = `航点 ${index + 1} · 离地 ${height} 米 · 拖动调整位置`;
      button.classList.toggle("selected", index === this.drawing.selectedIndex);
      button.dataset.heightMeters = String(height);
      const altitude = button.querySelector<HTMLElement>(
        ".route-elevated-height",
      );
      if (altitude) {
        altitude.hidden = this.drawing.showHeightLabels === false;
        altitude.textContent = `${height.toLocaleString("zh-CN", { maximumFractionDigits: 1, useGrouping: false })} m`;
      }
    });
  }
  private beginDrag(event: PointerEvent, index: number) {
    const map = this.map;
    if (!map || !this.latestMatrix || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.cleanupDrag?.();
    const start = this.drawing.points[index];
    if (!start) return;
    const originalX = event.clientX,
      originalY = event.clientY;
    let moved = false;
    const panWasEnabled = map.dragPan.isEnabled();
    map.dragPan.disable();
    const origin = this.projectAtHeight(start, index);
    if (!origin) {
      if (panWasEnabled) map.dragPan.enable();
      return;
    }
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const dx = pointer.clientX - originalX,
        dy = pointer.clientY - originalY;
      if (Math.hypot(dx, dy) > 3) moved = true;
      if (!moved) return;
      const point = invertRoutePosition(
        this.dragPoint?.point || start,
        { x: origin.x + dx, y: origin.y + dy },
        (candidate) => this.projectAtHeight(candidate, index),
      );
      if (!point) return;
      this.dragPoint = { index, point };
      map.triggerRepaint();
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return;
      const finalPoint = this.dragPoint?.point;
      this.cleanupDrag?.();
      this.dragPoint = undefined;
      if (moved && finalPoint && pointer.type !== "pointercancel") {
        this.drawing.onSelect(index);
        this.drawing.onMove(index, finalPoint);
      }
      map.triggerRepaint();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    this.cleanupDrag = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (panWasEnabled) map.dragPan.enable();
      this.cleanupDrag = undefined;
    };
  }
  private sampleTerrain(point: Point): number | null {
    const map = this.map;
    if (!map || this.terrainFailed) return null;
    const key = point.join(",");
    // queryTerrainElevation returns 0 for unloaded DEMs as well as real sea level.
    // Only label a value known after MapLibre confirms the DEM source is ready.
    if (
      map.getTerrain() &&
      map.getSource("terrain") &&
      map.getBounds().contains(point) &&
      map.isSourceLoaded("terrain")
    ) {
      const value = map.queryTerrainElevation(point);
      if (value !== null && Number.isFinite(value)) {
        this.terrainSamples.set(key, value);
        return value;
      }
    }
    return this.terrainSamples.get(key) ?? null;
  }
  private projectAtHeight(point: Point, index: number) {
    if (!this.map || !this.latestMatrix) return null;
    const elevation = resolveRouteElevation(
      this.sampleTerrain(point),
      this.drawing.heightMeters?.[index],
    );
    const projected = projectRoutePosition(
      this.latestMatrix,
      MercatorCoordinate.fromLngLat(point, elevation.air),
    );
    const canvas = this.map.getCanvas();
    return projected
      ? {
          x: ((projected.x + 1) * canvas.clientWidth) / 2,
          y: ((1 - projected.y) * canvas.clientHeight) / 2,
        }
      : null;
  }
  private prepare(gl: GL) {
    if (this.program && gl.isProgram(this.program)) return;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("无法创建航线着色器");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(message || "航线着色器编译失败");
      }
      return shader;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      "attribute vec3 a_position; attribute vec4 a_color; varying vec4 v_color; void main(){ gl_Position=vec4(a_position,1.0); v_color=a_color; }",
    );
    const fragment = compile(
      gl.FRAGMENT_SHADER,
      "precision mediump float; varying vec4 v_color; void main(){ gl_FragColor=v_color; }",
    );
    const program = gl.createProgram();
    if (!program) throw new Error("无法创建航线渲染程序");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      throw new Error("航线渲染程序链接失败");
    }
    this.program = program;
    this.buffer = gl.createBuffer() || undefined;
  }
  render(gl: GL, options: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.overlay) return;
    this.prepare(gl);
    this.latestMatrix = Array.from(options.defaultProjectionData.mainMatrix);
    const canvas = map.getCanvas();
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    let known = 0;
    const ground: (ProjectedRoutePoint | null)[] = [];
    const air = this.drawing.points.map((saved, index) => {
      const point =
        this.dragPoint?.index === index ? this.dragPoint.point : saved;
      const elevation = resolveRouteElevation(
        this.sampleTerrain(point),
        this.drawing.heightMeters?.[index],
      );
      if (elevation.known) known++;
      // A 0.3 m rendering bias avoids coplanar depth fighting for the white foot dot.
      ground.push(
        projectRoutePosition(
          this.latestMatrix!,
          MercatorCoordinate.fromLngLat(point, elevation.ground + 0.3),
        ),
      );
      return projectRoutePosition(
        this.latestMatrix!,
        MercatorCoordinate.fromLngLat(point, elevation.air),
      );
    });
    const status = `${known}/${air.length}`;
    this.overlay.dataset.terrainKnown = String(known);
    this.overlay.dataset.terrainTotal = String(air.length);
    if (status !== this.terrainStatus) {
      this.terrainStatus = status;
      this.drawing.onTerrainStatus?.({ known, total: air.length });
    }
    const labelBounds = air.map((point, index) => {
      const button = this.buttons[index];
      if (!button) return { x: 0, y: 0, width: 0, height: 0, visible: false };
      button.hidden =
        !point ||
        Math.abs(point.x) > 1.05 ||
        Math.abs(point.y) > 1.05 ||
        point.z > 1;
      if (!point) return { x: 0, y: 0, width: 0, height: 0, visible: false };
      const x = ((point.x + 1) * width) / 2,
        y = ((1 - point.y) * height) / 2;
      button.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      button.dataset.airX = String(x);
      button.dataset.airY = String(y);
      const foot = ground[index];
      if (foot) {
        button.dataset.groundX = String(((foot.x + 1) * width) / 2);
        button.dataset.groundY = String(((1 - foot.y) * height) / 2);
      }
      const label = button.querySelector<HTMLElement>(".route-elevated-label"),
        labelWidth =
          label?.offsetWidth ||
          (this.drawing.showHeightLabels === false ? 24 : 88),
        labelHeight = label?.offsetHeight || 28;
      // Keep labels inside the canvas near the right edge without moving their real handles.
      const left = x + 18 + labelWidth > width - 5 ? -labelWidth - 5 : 33;
      if (label) label.style.left = `${left}px`;
      return {
        x: x - 16 + left,
        y: y - 13,
        width: labelWidth,
        height: labelHeight,
        visible: !button.hidden,
      };
    });
    routeLabelVisibility(labelBounds, this.drawing.selectedIndex).forEach(
      (visible, index) => {
        this.buttons[index].dataset.labelVisible = String(visible);
      },
    );
    const vertices = routeMesh(
      air,
      ground,
      width,
      height,
      this.drawing.selectedIndex,
      this.drawing,
    );
    if (!vertices.length || !this.program || !this.buffer) return;
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    const position = gl.getAttribLocation(this.program, "a_position");
    const color = gl.getAttribLocation(this.program, "a_color");
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 7 * 4, 0);
    gl.vertexAttribPointer(color, 4, gl.FLOAT, false, 7 * 4, 3 * 4);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 7);
  }
  onRemove() {
    this.cleanupDrag?.();
    this.dragPoint = undefined;
    this.map?.off("error", this.terrainError);
    this.overlay?.remove();
    this.buttons = [];
    if (this.program) this.gl?.deleteProgram(this.program);
    if (this.buffer) this.gl?.deleteBuffer(this.buffer);
    this.program = undefined;
    this.buffer = undefined;
    this.map = undefined;
  }
}
