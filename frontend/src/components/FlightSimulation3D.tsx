import { useEffect, useRef, useState } from "react";
import { Crosshair, Navigation, Pause, Play, Power, Scan } from "lucide-react";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as LibreMap,
} from "maplibre-gl";
import {
  FLIGHT_LAYER_ID,
  FlightClock,
  orientAircraft,
  projectFlightPoint,
  type Point3,
} from "./flightSimulationMath";
import {
  AircraftReportHistory,
  DEFAULT_AIRCRAFT_DEFINITIONS,
  DemoAircraftReportProvider,
  reportedAircraftPosition,
  reportCount,
  validAircraftReport,
  type AircraftFlightDefinition,
  type AircraftPositionReport,
  type AircraftReportSnapshot,
} from "./flightReports";
import { visibleRouteSegment } from "./elevatedRoute";
import { SelectControl } from "./SelectControl";
import "./FlightSimulation3D.css";
export type {
  AircraftFlightDefinition,
  AircraftPositionReport,
} from "./flightReports";
type GL = WebGLRenderingContext | WebGL2RenderingContext;
type Color = [number, number, number, number];
type ModelTriangle = { points: [Point3, Point3, Point3]; color: Color };
type SimulationOptions = {
  time: () => number;
  tracks: () => AircraftReportSnapshot;
  definitions: readonly AircraftFlightDefinition[];
  selection: () => string;
  select: (id: string) => void;
  fail: () => void;
};
const aircraftColor = (
  definition: AircraftFlightDefinition,
): [number, number, number] => definition.color || [0.25, 0.8, 0.96];
const cameraDuration = (duration: number) =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : duration;
function triangle(
  mesh: ModelTriangle[],
  a: Point3,
  b: Point3,
  c: Point3,
  color: Color,
) {
  mesh.push({ points: [a, b, c], color });
}

function box(
  mesh: ModelTriangle[],
  center: Point3,
  half: Point3,
  color: Color,
) {
  const p = [
    [-1, -1, -1],
    [1, -1, -1],
    [1, 1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
    [1, -1, 1],
    [1, 1, 1],
    [-1, 1, 1],
  ].map(([x, y, z]) => ({
    x: center.x + x * half.x,
    y: center.y + y * half.y,
    z: center.z + z * half.z,
  }));
  for (const [a, b, c, d] of [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ]) {
    triangle(mesh, p[a], p[b], p[c], color);
    triangle(mesh, p[a], p[c], p[d], color);
  }
}

function plate(
  mesh: ModelTriangle[],
  outline: Point3[],
  thickness: number,
  color: Color,
) {
  const area = outline.reduce((sum, point, index) => {
    const next = outline[(index + 1) % outline.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (area < 0) outline = [...outline].reverse();
  const top = outline.map((p) => ({ ...p, z: p.z + thickness / 2 }));
  const bottom = outline.map((p) => ({ ...p, z: p.z - thickness / 2 }));
  for (let i = 1; i < outline.length - 1; i++) {
    triangle(mesh, top[0], top[i], top[i + 1], color);
    triangle(mesh, bottom[0], bottom[i + 1], bottom[i], color);
  }
  outline.forEach((_, i) => {
    const next = (i + 1) % outline.length;
    triangle(mesh, top[i], bottom[i], bottom[next], color);
    triangle(mesh, top[i], bottom[next], top[next], color);
  });
}

function fixedWing(color: [number, number, number]): ModelTriangle[] {
  const mesh: ModelTriangle[] = [],
    white: Color = [0.85, 0.94, 1, 1],
    accent: Color = [...color, 1];
  const sections = [
    { y: 13, r: 0.1 },
    { y: 8, r: 1.7 },
    { y: 1, r: 1.9 },
    { y: -9, r: 0.8 },
    { y: -12, r: 0.2 },
  ];
  for (let i = 1; i < sections.length; i++)
    for (let j = 0; j < 8; j++) {
      const ring = (section: (typeof sections)[number], angle: number) => ({
        x: Math.cos(angle) * section.r,
        y: section.y,
        z: Math.sin(angle) * section.r,
      });
      const a = ring(sections[i - 1], (j * Math.PI) / 4),
        b = ring(sections[i - 1], ((j + 1) * Math.PI) / 4),
        c = ring(sections[i], ((j + 1) * Math.PI) / 4),
        d = ring(sections[i], (j * Math.PI) / 4);
      const paint: Color =
        i === 1 && j >= 1 && j <= 3 ? [0.12, 0.28, 0.37, 1] : white;
      triangle(mesh, a, b, c, paint);
      triangle(mesh, a, c, d, paint);
    }
  for (const side of [-1, 1]) {
    plate(
      mesh,
      [
        { x: side, y: 3, z: 0 },
        { x: side * 14, y: -3, z: 0 },
        { x: side * 13, y: -4.2, z: 0 },
        { x: side, y: -1.5, z: 0 },
      ],
      0.55,
      white,
    );
    plate(
      mesh,
      [
        { x: side * 10, y: -1.1, z: 0.36 },
        { x: side * 14, y: -3, z: 0.36 },
        { x: side * 13, y: -4.2, z: 0.36 },
        { x: side * 10, y: -3.5, z: 0.36 },
      ],
      0.08,
      accent,
    );
    plate(
      mesh,
      [
        { x: side * 0.4, y: -8, z: 0.1 },
        { x: side * 5.6, y: -10, z: 0.1 },
        { x: side * 5, y: -11.4, z: 0.1 },
        { x: side * 0.4, y: -10.8, z: 0.1 },
      ],
      0.3,
      accent,
    );
  }
  triangle(
    mesh,
    { x: 0, y: -7.4, z: 0.7 },
    { x: 0, y: -10.5, z: 5.2 },
    { x: 0, y: -12, z: 0.3 },
    accent,
  );
  box(mesh, { x: 0, y: 2, z: -1.35 }, { x: 0.7, y: 2.7, z: 0.35 }, accent);
  return mesh;
}
function multirotor(
  color: [number, number, number],
  seconds: number,
): ModelTriangle[] {
  const mesh: ModelTriangle[] = [],
    dark: Color = [0.17, 0.27, 0.34, 1],
    white: Color = [0.83, 0.95, 1, 1],
    accent: Color = [...color, 1];
  box(mesh, { x: 0, y: 0, z: 0 }, { x: 1.55, y: 2.1, z: 0.85 }, white);
  box(mesh, { x: 0, y: 1.1, z: 0.92 }, { x: 1.1, y: 0.85, z: 0.16 }, accent);
  box(mesh, { x: 0, y: 1.9, z: -1 }, { x: 0.6, y: 0.6, z: 0.45 }, dark);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const x = sx * 4.5,
        y = sy * 4.5,
        w = 0.42;
      plate(
        mesh,
        [
          { x: -sy * w, y: sx * w, z: 0 },
          { x: x - sy * w, y: y + sx * w, z: 0 },
          { x: x + sy * w, y: y - sx * w, z: 0 },
          { x: sy * w, y: -sx * w, z: 0 },
        ],
        0.58,
        dark,
      );
      box(mesh, { x, y, z: 0.4 }, { x: 0.62, y: 0.62, z: 0.65 }, accent);
      for (let j = 0; j < 16; j++) {
        const p = (a: number, r: number) => ({
            x: x + Math.cos(a) * r,
            y: y + Math.sin(a) * r,
            z: 1.3,
          }),
          a = (j * Math.PI) / 8,
          b = ((j + 1) * Math.PI) / 8;
        triangle(mesh, p(a, 2.6), p(a, 2.35), p(b, 2.6), [...color, 0.45]);
        triangle(mesh, p(a, 2.35), p(b, 2.35), p(b, 2.6), [...color, 0.45]);
      }
      const angle = seconds * 24 * sx * sy,
        rotate = (dx: number, dy: number) => ({
          x: x + Math.cos(angle) * dx - Math.sin(angle) * dy,
          y: y + Math.sin(angle) * dx + Math.cos(angle) * dy,
          z: 1.37,
        });
      plate(
        mesh,
        [
          rotate(-2.5, -0.2),
          rotate(2.5, -0.2),
          rotate(2.5, 0.2),
          rotate(-2.5, 0.2),
        ],
        0.12,
        white,
      );
    }
  return mesh;
}
function flightViewport(map: LibreMap) {
  const board = map.getContainer().closest<HTMLElement>(".command-board");
  const canvas = map.getCanvas();
  const canvasRect = canvas.getBoundingClientRect();
  const rect = (selector: string) =>
    board?.querySelector(selector)?.getBoundingClientRect();
  const leftRect = rect(".command-left"),
    rightRect = rect(".command-right");
  const controlRect = rect(".flight-sim-controls"),
    chartsRect = rect(".command-bottom-charts");
  // CSS custom properties may contain unresolved calc/clamp expressions. Measure the
  // visible panels instead, including their actual responsive widths and chart height.
  const left = leftRect?.width ? leftRect.right - canvasRect.left + 18 : 280;
  const right = rightRect?.width ? canvasRect.right - rightRect.left + 18 : 280;
  const top = controlRect?.height
    ? controlRect.bottom - canvasRect.top + 28
    : 205;
  const bottom = chartsRect?.height
    ? canvasRect.bottom - chartsRect.top + 24
    : 200;
  const width = canvas.clientWidth || 1440,
    height = canvas.clientHeight || 800;
  return { left, right, top, bottom, width, height };
}

function cameraFrame(map: LibreMap, follow = false) {
  const { left, right, top, bottom, width, height } = flightViewport(map);
  const free = Math.max(250, width - left - right);
  const ratio = Math.min(
    free / 1000,
    Math.max(180, height - top - bottom) / 500,
  );
  return {
    zoom: follow
      ? Math.max(14.1, Math.min(15.4, 15.4 + Math.log2(ratio)))
      : Math.max(13.3, Math.min(15.2, 14.8 + Math.log2(ratio))),
    pitch: 60,
    bearing: -22,
    offset: [(left - right) / 2, (top - bottom) / 2] as [number, number],
  };
}

export class AircraftFlightLayer implements CustomLayerInterface {
  id = FLIGHT_LAYER_ID;
  type = "custom" as const;
  renderingMode = "3d" as const;
  private map?: LibreMap;
  private gl?: GL;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private positionLocation = -1;
  private colorLocation = -1;
  private overlay?: HTMLDivElement;
  private labels: HTMLButtonElement[] = [];
  private groundSamples = new Map<string, number>();
  private worldSamples = new WeakMap<
    AircraftPositionReport,
    { phase: number; point: MercatorCoordinate }
  >();
  private terrainReadyAt: number | null = null;
  private terrainFailed = false;
  private failed = false;
  private readonly motionQuery = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  );
  private terrainError = (event: { sourceId?: string }) => {
    if (event.sourceId === "terrain") {
      this.terrainFailed = true;
      this.groundSamples.clear();
      this.terrainReadyAt = null;
    }
  };
  constructor(private options: SimulationOptions) {}
  onAdd(map: LibreMap, gl: GL) {
    this.map = map;
    this.gl = gl;
    this.overlay = document.createElement("div");
    this.overlay.className = "flight-simulation-overlay";
    this.overlay.dataset.layerReady = "true";
    this.overlay.dataset.aircraftCount = String(
      this.options.definitions.length,
    );
    map.getContainer().append(this.overlay);
    this.labels = this.options.definitions.map((aircraft) => {
      const label = document.createElement("button");
      label.type = "button";
      label.className = "flight-simulation-aircraft";
      label.style.setProperty(
        "--aircraft-color",
        `rgb(${aircraftColor(aircraft)
          .map((n) => Math.round(n * 255))
          .join(" ")})`,
      );
      label.dataset.aircraftId = aircraft.deviceId;
      label.dataset.kind = aircraft.kind;
      label.setAttribute("aria-label", `选择${aircraft.name}`);
      label.title = `选择${aircraft.name}，可在工具栏开启跟随`;
      const name = document.createElement("strong");
      name.textContent = aircraft.name;
      label.append(name, document.createElement("small"));
      label.addEventListener("pointerdown", (event) => event.stopPropagation());
      label.addEventListener("click", (event) => {
        event.stopPropagation();
        this.options.select(aircraft.deviceId);
      });
      this.overlay!.append(label);
      return label;
    });
    map.on("error", this.terrainError);
  }
  private terrain(point: [number, number]): number {
    const key = `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
    const saved = this.groundSamples.get(key);
    const smooth = (height: number) => {
      if (this.terrainReadyAt === null)
        this.terrainReadyAt = this.options.time();
      const t = Math.max(
        0,
        Math.min(1, (this.options.time() - this.terrainReadyAt) / 1.6),
      );
      return height * t * t * (3 - 2 * t);
    };
    if (saved !== undefined) return smooth(saved);
    const map = this.map;
    if (
      !map ||
      this.terrainFailed ||
      !map.getTerrain() ||
      !map.getSource("terrain") ||
      !map.isSourceLoaded("terrain")
    )
      return 0;
    const height = map.queryTerrainElevation(point);
    if (height === null || !Number.isFinite(height)) return 0;
    if (this.groundSamples.size >= 4096) this.groundSamples.clear();
    this.groundSamples.set(key, height);
    return smooth(height);
  }
  private prepare(gl: GL) {
    if (this.program && gl.isProgram(this.program)) return;
    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Aircraft shader unavailable");
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error("Aircraft shader compilation failed");
      return shader;
    };
    try {
      const vertex = compile(
        gl.VERTEX_SHADER,
        "attribute vec3 a_position; attribute vec4 a_color; varying vec4 v_color; void main(){gl_Position=vec4(a_position,1.0);v_color=a_color;}",
      );
      const fragment = compile(
        gl.FRAGMENT_SHADER,
        "precision mediump float; varying vec4 v_color; void main(){gl_FragColor=v_color;}",
      );
      this.program = gl.createProgram() || undefined;
      if (!this.program) throw new Error("Aircraft program unavailable");
      gl.attachShader(this.program, vertex);
      gl.attachShader(this.program, fragment);
      gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw new Error("Aircraft shader link failed");
      this.buffer = gl.createBuffer() || undefined;
      if (!this.buffer) throw new Error("Aircraft buffer unavailable");
      this.positionLocation = gl.getAttribLocation(this.program, "a_position");
      this.colorLocation = gl.getAttribLocation(this.program, "a_color");
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
  }

  render(gl: GL, input: CustomRenderMethodInput) {
    if (!this.map || !this.overlay || this.failed) return;
    try {
      this.prepare(gl);
      this.draw(gl, input, this.map);
    } catch {
      this.failed = true;
      this.overlay.dataset.layerReady = "false";
      this.labels.forEach((label) => {
        label.hidden = true;
      });
      this.options.fail();
    }
  }
  private draw(gl: GL, input: CustomRenderMethodInput, map: LibreMap) {
    const matrix = input.defaultProjectionData.mainMatrix,
      { clientWidth: width, clientHeight: height } = map.getCanvas();
    if (!width || !height || !this.program || !this.buffer) return;
    const seconds = this.options.time(),
      snapshot = this.options.tracks(),
      effects: number[] = [],
      models: number[] = [];
    const face = (
      target: number[],
      a: Point3,
      b: Point3,
      c: Point3,
      color: Color,
    ) => {
      for (const p of [a, b, c]) target.push(p.x, p.y, p.z, ...color);
    };
    const offset = (p: Point3, x: number, y: number): Point3 => ({
      x: p.x + (2 * x) / width,
      y: p.y + (2 * y) / height,
      z: p.z,
    });
    const interpolate = (a: Point3, b: Point3, t: number): Point3 => ({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    });
    const line = (
      a: Point3 | null,
      b: Point3 | null,
      size: number,
      color: Color,
    ) => {
      if (!a || !b) return;
      const clip = visibleRouteSegment(a, b, 12 / width, 12 / height);
      if (!clip) return;
      const start = interpolate(a, b, clip[0]),
        end = interpolate(a, b, clip[1]),
        dx = ((end.x - start.x) * width) / 2,
        dy = ((end.y - start.y) * height) / 2,
        length = Math.hypot(dx, dy);
      if (length < 0.08) return;
      const nx = ((-dy / length) * size) / 2,
        ny = ((dx / length) * size) / 2,
        a1 = offset(start, nx, ny),
        a2 = offset(start, -nx, -ny),
        b1 = offset(end, nx, ny),
        b2 = offset(end, -nx, -ny);
      face(effects, a1, a2, b1, color);
      face(effects, a2, b2, b1, color);
    };
    const project = (p: Point3) => projectFlightPoint(matrix, p);
    const world = (report: AircraftPositionReport, ground = false) => {
      const lngLat: [number, number] = [report.longitude, report.latitude];
      const phase =
        report.altitudeReference === "AMSL"
          ? 1
          : this.terrainReadyAt === null
            ? -1
            : Math.max(0, Math.min(1, (seconds - this.terrainReadyAt) / 1.6));
      const cached = !ground ? this.worldSamples.get(report) : undefined;
      if (cached?.phase === phase) return cached.point;
      const point = MercatorCoordinate.fromLngLat(
        lngLat,
        ground
          ? this.terrain(lngLat) + 0.6
          : report.altitudeReference === "AMSL"
            ? report.altitudeMeters
            : this.terrain(lngLat) + report.altitudeMeters,
      );
      if (!ground) this.worldSamples.set(report, { phase, point });
      return point;
    };
    const positions: { index: number; point: Point3; selected: boolean }[] = [];
    this.overlay!.dataset.reportCount = String(reportCount(snapshot));
    this.options.definitions.forEach((aircraft, index) => {
      const track = snapshot.get(aircraft.deviceId),
        position = reportedAircraftPosition(track, seconds),
        label = this.labels[index];
      if (!position || !track) {
        label.hidden = true;
        return;
      }
      const color = aircraftColor(aircraft),
        selected = this.options.selection() === aircraft.deviceId;
      // Connect only retained observations in timestamp order. There is no future route
      // and no time-based tail window; every segment survives until the history cap.
      let previous: Point3 | null = null;
      let previousReference:
        AircraftPositionReport["altitudeReference"] | undefined;
      for (const report of track.reports) {
        const point = project(world(report));
        if (previousReference === report.altitudeReference)
          line(previous, point, 2.2, [...color, 0.92]);
        previous = point;
        previousReference = report.altitudeReference;
      }
      const anchor = world(position),
        air = project(anchor),
        ground = project(world(position, true));
      if (air && ground) {
        const distance = Math.hypot(
            ((air.x - ground.x) * width) / 2,
            ((air.y - ground.y) * height) / 2,
          ),
          steps = Math.min(80, Math.max(1, Math.ceil(distance / 9)));
        for (let j = 0; j < steps; j++)
          line(
            interpolate(ground, air, j / steps),
            interpolate(ground, air, Math.min(1, (j + 0.4) / steps)),
            1,
            [...color, selected ? 0.42 : 0.23],
          );
      }
      label.hidden = !air || Math.abs(air.x) > 1.05 || Math.abs(air.y) > 1.05;
      label.classList.toggle("selected", selected);
      label.setAttribute("aria-pressed", String(selected));
      label.title = selected
        ? `${aircraft.name}已选中，可在工具栏开启跟随`
        : `选择${aircraft.name}，可在工具栏开启跟随`;
      const latest = track.reports.at(-1)!;
      label.dataset.reportCount = String(track.reports.length);
      label.dataset.firstReportTimestamp = String(track.reports[0].timestamp);
      label.dataset.latestReportTimestamp = String(latest.timestamp);
      label.dataset.latestLongitude = String(latest.longitude);
      label.dataset.latestLatitude = String(latest.latitude);
      label.dataset.latestHeight = String(latest.altitudeMeters);
      label.dataset.renderedTimestamp = position.timestamp.toFixed(3);
      label.dataset.firstReportAt = String(track.reports[0].timestamp);
      label.dataset.lastReportAt = String(latest.timestamp);
      label.dataset.lastReportLng = String(latest.longitude);
      label.dataset.lastReportLat = String(latest.latitude);
      label.dataset.lastReportAltitude = String(latest.altitudeMeters);
      label.dataset.renderedAt = position.timestamp.toFixed(3);
      const previousReport = track.reports.at(-2) || latest;
      label.dataset.previousReportLng = String(previousReport.longitude);
      label.dataset.previousReportLat = String(previousReport.latitude);
      label.dataset.previousReportAltitude = String(
        previousReport.altitudeMeters,
      );
      label.dataset.previousReportAt = String(previousReport.timestamp);
      label.dataset.altitudeReference = position.altitudeReference;
      label.dataset.longitude = label.dataset.lng =
        position.longitude.toFixed(7);
      label.dataset.latitude = label.dataset.lat = position.latitude.toFixed(7);
      label.dataset.height = label.dataset.altitude =
        position.altitudeMeters.toFixed(2);
      label.dataset.phase = seconds.toFixed(3);
      const text = label.querySelector("small");
      if (text)
        text.textContent = `${position.altitudeReference === "AGL" ? "离地" : "海拔"} ${Math.round(position.altitudeMeters)} m · ${position.speedMetersPerSecond.toFixed(1)} m/s`;
      if (air) {
        label.dataset.airX = (((air.x + 1) * width) / 2).toFixed(2);
        label.dataset.airY = (((1 - air.y) * height) / 2).toFixed(2);
        if (!label.hidden) positions.push({ index, point: air, selected });
      }
      if (ground) {
        label.dataset.groundX = (((ground.x + 1) * width) / 2).toFixed(2);
        label.dataset.groundY = (((1 - ground.y) * height) / 2).toFixed(2);
      }
      if (!air || Math.abs(air.x) > 1.15 || Math.abs(air.y) > 1.15) return;
      const units = anchor.meterInMercatorCoordinateUnits(),
        east = project({ x: anchor.x + units, y: anchor.y, z: anchor.z }),
        north = project({ x: anchor.x, y: anchor.y - units, z: anchor.z });
      const ppm = Math.max(
          0.001,
          east
            ? Math.hypot(
                ((east.x - air.x) * width) / 2,
                ((east.y - air.y) * height) / 2,
              )
            : 0,
          north
            ? Math.hypot(
                ((north.x - air.x) * width) / 2,
                ((north.y - air.y) * height) / 2,
              )
            : 0,
        ),
        span = aircraft.kind === "fixed-wing" ? 28 : 14.5,
        scale = Math.max(1, Math.min(70, (selected ? 46 : 40) / (span * ppm)));
      const mesh =
          aircraft.kind === "fixed-wing"
            ? fixedWing(color)
            : multirotor(color, this.motionQuery?.matches ? 0 : seconds),
        pose = {
          heading: (position.headingDegrees * Math.PI) / 180,
          pitch: position.pitchRadians,
          bank: 0,
        };
      for (const model of mesh) {
        const oriented = model.points.map((p) => orientAircraft(p, pose)),
          points = oriented.map((p) =>
            project({
              x: anchor.x + p.x * units * scale,
              y: anchor.y - p.y * units * scale,
              z: anchor.z + p.z * units * scale,
            }),
          );
        if (points.some((p) => !p)) continue;
        const [a, b, c] = oriented,
          ux = b.x - a.x,
          uy = b.y - a.y,
          uz = b.z - a.z,
          vx = c.x - a.x,
          vy = c.y - a.y,
          vz = c.z - a.z,
          nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx,
          norm = Math.hypot(nx, ny, nz) || 1,
          light =
            0.52 +
            0.48 * Math.max(0, (nx * 0.28 - ny * 0.38 + nz * 0.88) / norm);
        face(models, points[0]!, points[1]!, points[2]!, [
          model.color[0] * light,
          model.color[1] * light,
          model.color[2] * light,
          model.color[3],
        ]);
      }
    });
    const viewport = flightViewport(map),
      safe = {
        left: viewport.left + 8,
        right: width - viewport.right - 8,
        top: viewport.top + 8,
        bottom: height - viewport.bottom - 8,
      },
      placed: { x: number; y: number; width: number; height: number }[] = [];
    positions.sort((a, b) => Number(b.selected) - Number(a.selected));
    for (const entry of positions) {
      const label = this.labels[entry.index],
        w = label.offsetWidth || 120,
        h = label.offsetHeight || 39,
        x = ((entry.point.x + 1) * width) / 2,
        y = ((1 - entry.point.y) * height) / 2,
        minX = Math.min(safe.left, width - w - 8),
        maxX = Math.max(minX, safe.right - w),
        minY = Math.min(safe.top, height - h - 8),
        maxY = Math.max(minY, safe.bottom - h);
      let best = { x: minX, y: minY },
        score = Infinity;
      for (const candidate of [
        [x + 26, y - h - 9],
        [x + 26, y + 12],
        [x - w - 26, y - h - 9],
        [x - w - 26, y + 12],
        [minX, minY],
        [maxX, minY],
        [minX, maxY],
        [maxX, maxY],
      ]) {
        const cx = Math.max(minX, Math.min(maxX, candidate[0])),
          cy = Math.max(minY, Math.min(maxY, candidate[1]));
        const overlap = placed.reduce(
          (sum, p) =>
            sum +
            Math.max(
              0,
              Math.min(cx + w + 6, p.x + p.width + 6) - Math.max(cx, p.x),
            ) *
              Math.max(
                0,
                Math.min(cy + h + 6, p.y + p.height + 6) - Math.max(cy, p.y),
              ),
          0,
        );
        const modelOverlap = positions.reduce((sum, p) => {
          const px = ((p.point.x + 1) * width) / 2,
            py = ((1 - p.point.y) * height) / 2;
          return (
            sum +
            Math.max(0, Math.min(cx + w, px + 25) - Math.max(cx, px - 25)) *
              Math.max(0, Math.min(cy + h, py + 25) - Math.max(cy, py - 25))
          );
        }, 0);
        const value =
          overlap * 100 +
          modelOverlap * 60 +
          Math.hypot(cx + w / 2 - x, cy + h / 2 - y);
        if (value < score) {
          score = value;
          best = { x: cx, y: cy };
        }
      }
      label.style.transform = `translate(${best.x}px,${best.y}px)`;
      placed.push({ ...best, width: w, height: h });
      const ex = Math.max(best.x, Math.min(best.x + w, x)),
        ey = Math.max(best.y, Math.min(best.y + h, y));
      if (Math.hypot(ex - x, ey - y) > 18)
        line(entry.point, offset(entry.point, ex - x, y - ey), 0.8, [
          ...aircraftColor(this.options.definitions[entry.index]),
          0.4,
        ]);
    }
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, 28, 12);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    for (const [vertices, depth] of [
      [effects, false],
      [models, true],
    ] as const) {
      if (!vertices.length) continue;
      gl.depthMask(depth);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertices),
        gl.DYNAMIC_DRAW,
      );
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 7);
    }
    gl.depthMask(true);
    gl.disableVertexAttribArray(this.positionLocation);
    gl.disableVertexAttribArray(this.colorLocation);
  }
  onRemove() {
    this.map?.off("error", this.terrainError);
    this.overlay?.remove();
    this.labels = [];
    this.groundSamples.clear();
    if (this.program) this.gl?.deleteProgram(this.program);
    if (this.buffer) this.gl?.deleteBuffer(this.buffer);
    this.program = undefined;
    this.buffer = undefined;
    this.overlay = undefined;
    this.map = undefined;
  }
}

export type FlightSimulation3DProps = {
  map: LibreMap | null;
  ready: boolean;
  styleEpoch: number;
  threeD: boolean;
  onRequest3D: () => void;
  reports?: readonly AircraftPositionReport[];
  definitions?: readonly AircraftFlightDefinition[];
  /** Change only when switching the flight/session stream; empty batches retain history. */
  streamKey?: string;
};
type Session = {
  history: AircraftReportHistory;
  provider: DemoAircraftReportProvider;
  display: AircraftReportSnapshot;
  external: boolean;
};
function createSession(external: boolean): Session {
  const history = new AircraftReportHistory(),
    provider = new DemoAircraftReportProvider();
  if (!external) history.ingest(provider.initialReports(), 0);
  return { history, provider, display: history.snapshot(), external };
}
function frameScene(
  map: LibreMap,
  snapshot: AircraftReportSnapshot,
  overview = false,
  threeD = true,
) {
  let west = Infinity,
    east = -Infinity,
    south = Infinity,
    north = -Infinity;
  snapshot.forEach((track) =>
    track.reports.forEach((report) => {
      west = Math.min(west, report.longitude);
      east = Math.max(east, report.longitude);
      south = Math.min(south, report.latitude);
      north = Math.max(north, report.latitude);
    }),
  );
  if (!Number.isFinite(west)) return false;
  const viewport = flightViewport(map);
  if (west === east && south === north)
    map.flyTo({
      center: [west, south],
      ...cameraFrame(map),
      zoom: overview ? 12 : 15.2,
      pitch: threeD ? 60 : 0,
      duration: cameraDuration(850),
    });
  else {
    const bounds: [[number, number], [number, number]] = [
      [west, south],
      [east, north],
    ];
    const options = {
      padding: {
        left: viewport.left + 35,
        right: viewport.right + 35,
        top: viewport.top + 70,
        bottom: viewport.bottom + 35,
      },
      maxZoom: overview ? 11.2 : cameraFrame(map).zoom,
      bearing: -22,
    };
    // Compute an inset camera without retaining map padding, which would otherwise
    // move subsequent follow/overview centres a second time.
    if (typeof map.cameraForBounds === "function") {
      const camera = map.cameraForBounds(bounds, options);
      if (camera)
        map.flyTo({
          ...camera,
          pitch: threeD ? 60 : 0,
          duration: cameraDuration(850),
        });
    } else
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: {
            left: viewport.left + 35,
            right: viewport.right + 35,
            top: viewport.top + 70,
            bottom: viewport.bottom + 35,
          },
          maxZoom: overview ? 11.2 : cameraFrame(map).zoom,
          pitch: threeD ? 60 : 0,
          bearing: -22,
          duration: cameraDuration(850),
        },
      );
  }
  return true;
}
export default function FlightSimulation3D({
  map,
  ready,
  styleEpoch,
  threeD,
  onRequest3D,
  reports,
  definitions,
  streamKey,
}: FlightSimulation3DProps) {
  const [enabled, setEnabled] = useState(true),
    [paused, setPaused] = useState(false),
    [selected, setSelected] = useState(""),
    [following, setFollowing] = useState(false),
    [notice, setNotice] = useState(""),
    [hidden, setHidden] = useState(() => document.hidden),
    [failed, setFailed] = useState(false),
    [, refresh] = useState(0);
  const clock = useRef(new FlightClock()),
    session = useRef<Session | null>(null);
  if (!session.current) session.current = createSession(reports !== undefined);
  const current = session.current,
    external = reports !== undefined;
  const stream = useRef(streamKey);
  const validIds = new Set([
    ...current.history.snapshot().keys(),
    ...(reports || [])
      .filter(validAircraftReport)
      .map((report) => report.deviceId),
  ]);
  const config = new Map(
    (definitions || DEFAULT_AIRCRAFT_DEFINITIONS).map((definition) => [
      definition.deviceId,
      definition,
    ]),
  );
  const fleet: readonly AircraftFlightDefinition[] = external
    ? [...validIds].map(
        (deviceId) =>
          config.get(deviceId) || {
            deviceId,
            name: deviceId,
            kind: "multirotor",
          },
      )
    : definitions || DEFAULT_AIRCRAFT_DEFINITIONS;
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;
  const signature = JSON.stringify(fleet),
    selection = useRef(selected);
  selection.current = selected || fleet[0]?.deviceId || "";
  const follow = useRef(following),
    followTransitionPending = useRef(false);
  follow.current = following;
  const controls = useRef<HTMLDivElement>(null),
    initializedCamera = useRef(false),
    request3D = useRef(onRequest3D);
  request3D.current = onRequest3D;
  const isFrozen = useRef(paused || hidden);
  isFrozen.current = paused || hidden;
  const telemetry = () => {
    if (!controls.current) return;
    controls.current.dataset.seconds = clock.current.seconds.toFixed(3);
    controls.current.dataset.reportCount = String(reportCount(current.display));
    controls.current.dataset.receivedReportCount = String(
      reportCount(current.history.snapshot()),
    );
  };
  useEffect(() => {
    const visibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!threeD && follow.current) {
      follow.current = false;
      setFollowing(false);
      setNotice("已切换 2D · 跟随已退出");
    }
  }, [threeD]);
  useEffect(() => {
    if (!fleet.some((item) => item.deviceId === selected)) {
      setSelected(fleet[0]?.deviceId || "");
      follow.current = false;
      setFollowing(false);
    }
  }, [signature, selected]);
  useEffect(() => {
    if (current.external !== external || stream.current !== streamKey) {
      current.history.clear();
      current.provider = new DemoAircraftReportProvider();
      clock.current.reset();
      current.external = external;
      stream.current = streamKey;
      current.display = current.history.snapshot();
      follow.current = false;
      setFollowing(false);
      initializedCamera.current = false;
      if (!external)
        current.history.ingest(current.provider.initialReports(), 0);
    }
    if (external) {
      current.history.ingest(reports!, clock.current.seconds);
    }
    if (!isFrozen.current) current.display = current.history.snapshot();
    telemetry();
    refresh((value) => value + 1);
    if (map && ready && !isFrozen.current) map.triggerRepaint();
  }, [reports, external, streamKey]);
  useEffect(() => {
    if (!paused && !hidden) {
      current.display = current.history.snapshot();
      telemetry();
      map?.triggerRepaint();
    }
  }, [paused, hidden]);
  useEffect(() => {
    if (!map || !ready || !enabled) return;
    setFailed(false);
    const layer = new AircraftFlightLayer({
      time: () => clock.current.seconds,
      tracks: () => current.display,
      definitions: fleetRef.current,
      selection: () => selection.current,
      select: selectAircraft,
      fail: () => setFailed(true),
    });
    try {
      map.addLayer(layer);
      map.triggerRepaint();
    } catch {
      setFailed(true);
    }
    return () => {
      try {
        if (map.getLayer(FLIGHT_LAYER_ID)) map.removeLayer(FLIGHT_LAYER_ID);
        else layer.onRemove();
      } catch {
        layer.onRemove();
      }
    };
  }, [map, ready, styleEpoch, enabled, signature, streamKey, external]);

  useEffect(() => {
    if (
      !map ||
      !ready ||
      !enabled ||
      paused ||
      hidden ||
      initializedCamera.current ||
      !reportCount(current.display)
    )
      return;
    initializedCamera.current = true;
    frameScene(map, current.display, false, threeD);
  }, [map, ready, enabled, paused, hidden, streamKey, signature, reports]);
  useEffect(() => {
    if (!map || !ready || !enabled || paused || hidden || failed) {
      clock.current.suspend();
      return;
    }
    let active = true,
      raf = 0,
      previous = -Infinity,
      cameraAt = -Infinity;
    clock.current.suspend();
    const frame = (timestamp: number) => {
      if (!active) return;
      if (timestamp - previous >= 1000 / 30) {
        previous = timestamp;
        const time = clock.current.advance(timestamp);
        if (!current.external) {
          const next = current.provider.advance(time);
          if (next.length) {
            current.history.ingest(next, time);
            current.display = current.history.snapshot();
          }
        }
        telemetry();
        // Let the initial close-up finish before the tracking camera takes over;
        // otherwise the next telemetry frame interrupts the flyTo transition.
        if (follow.current && followTransitionPending.current) {
          cameraAt = timestamp + cameraDuration(650) - 100;
          followTransitionPending.current = false;
        }
        if (follow.current && timestamp - cameraAt >= 100) {
          cameraAt = timestamp;
          const position = reportedAircraftPosition(
            current.display.get(selection.current),
            time,
          );
          if (position)
            map.easeTo({
              center: [position.longitude, position.latitude],
              ...cameraFrame(map, true),
              duration: cameraDuration(160),
            });
        }
        map.triggerRepaint();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      active = false;
      cancelAnimationFrame(raf);
      clock.current.suspend();
    };
  }, [map, ready, enabled, paused, hidden, failed]);
  useEffect(() => {
    if (!map || !ready) return;
    const manual = (event: {
      originalEvent?: unknown;
      businessObjectFocus?: boolean;
    }) => {
      if (
        (event.originalEvent || event.businessObjectFocus === true) &&
        follow.current
      ) {
        follow.current = false;
        followTransitionPending.current = false;
        setFollowing(false);
        setNotice(
          event.businessObjectFocus === true
            ? "已定位业务对象 · 退出飞行跟随"
            : "已退出跟随 · 可自由浏览地图",
        );
      }
    };
    for (const event of [
      "movestart",
      "dragstart",
      "rotatestart",
      "pitchstart",
      "zoomstart",
      "wheel",
    ] as const)
      map.on(event, manual);
    return () => {
      for (const event of [
        "movestart",
        "dragstart",
        "rotatestart",
        "pitchstart",
        "zoomstart",
        "wheel",
      ] as const)
        map.off(event, manual);
    };
  }, [map, ready]);
  useEffect(() => {
    if (map && ready) map.triggerRepaint();
  }, [selected, paused, following, map, ready, threeD]);
  const aircraft = fleet.find((item) => item.deviceId === selected) || fleet[0],
    activeCount = [...current.display.values()].filter(
      (track) => track.reports.length,
    ).length;
  const feedback = failed
    ? "飞行图层暂不可用，请关闭后重新开启"
    : !enabled
      ? "航迹已隐藏 · 开启后恢复显示"
      : !ready
        ? "地图准备中"
        : !activeCount
          ? "等待航空器位置上报"
          : hidden
            ? "页面已隐藏 · 航迹画面暂停"
            : paused
              ? "画面已暂停 · 继续后显示最新上报"
              : following
                ? `正在跟随 ${aircraft?.name} · 拖动地图退出`
                : notice || `已选 ${aircraft?.name} · 点击标签切换航空器`;
  function selectAircraft(id: string) {
    const target = fleetRef.current.find((item) => item.deviceId === id);
    if (!target) return;
    if (id !== selection.current) {
      follow.current = false;
      setFollowing(false);
    }
    selection.current = id;
    setSelected(id);
    setNotice(`已选 ${target.name} · 点击跟随锁定视角`);
  }
  function overview() {
    follow.current = false;
    setFollowing(false);
    if (map && frameScene(map, current.display, true, threeD))
      setNotice("已恢复全市总览 · 可自由浏览地图");
  }
  function toggleEnabled() {
    if (enabled) {
      overview();
      setEnabled(false);
      setNotice("");
      clock.current.suspend();
    } else {
      if (!current.external) {
        clock.current.reset();
        current.provider = new DemoAircraftReportProvider();
        current.history.clear();
        current.history.ingest(current.provider.initialReports(), 0);
        current.display = current.history.snapshot();
      }
      initializedCamera.current = false;
      setPaused(false);
      setEnabled(true);
      setFailed(false);
      setNotice("航迹已开启 · 已恢复飞行视野");
    }
  }
  function toggleFollow() {
    if (following) {
      follow.current = false;
      setFollowing(false);
      setNotice("已退出跟随 · 可自由浏览地图");
      return;
    }
    const position = reportedAircraftPosition(
      current.display.get(selection.current),
      clock.current.seconds,
    );
    if (!position) return;
    request3D.current();
    follow.current = true;
    followTransitionPending.current = true;
    setFollowing(true);
    map?.flyTo({
      center: [position.longitude, position.latitude],
      ...cameraFrame(map, true),
      duration: cameraDuration(650),
    });
  }
  return (
    <div
      className={`flight-sim-controls${!enabled ? " collapsed" : ""}`}
      ref={controls}
      data-testid="flight-simulation"
      data-enabled={enabled}
      data-paused={paused}
      data-following={following ? selection.current : ""}
      data-source={external ? "reports" : "demo"}
      data-seconds={clock.current.seconds.toFixed(3)}
      data-report-count={reportCount(current.display)}
      data-received-report-count={reportCount(current.history.snapshot())}
      role="group"
      aria-label="空中航迹控制"
    >
      {enabled && (
        <>
          <span
            className={`flight-sim-live${paused || hidden ? " stopped" : ""}`}
            title={
              paused || hidden ? "画面更新已暂停" : "按航空器位置上报更新航迹"
            }
          >
            <i />
            空中航迹 <b>{String(activeCount).padStart(2, "0")}</b>
          </span>
          <div className="flight-sim-selector">
            <SelectControl
              aria-label="选择航空器"
              value={selected}
              disabled={!fleet.length}
              onChange={selectAircraft}
              options={fleet.map((item) => ({
                value: item.deviceId,
                label: `${item.name} · ${item.kind === "multirotor" ? "多旋翼" : "固定翼"}`,
              }))}
            />
          </div>
          <button
            type="button"
            disabled={!ready || failed}
            aria-label={paused ? "继续飞行" : "暂停飞行"}
            aria-pressed={paused}
            title={
              paused
                ? "继续画面更新，显示最新已接收上报"
                : "暂停画面更新，保留当前航迹"
            }
            className={paused ? "active" : ""}
            onClick={() => {
              setPaused((value) => !value);
              setNotice(paused ? "画面已继续 · 显示最新上报" : "");
            }}
          >
            {paused ? <Play size={13} /> : <Pause size={13} />}
            <span>{paused ? "继续" : "暂停"}</span>
          </button>
          <button
            type="button"
            disabled={
              !ready ||
              failed ||
              !aircraft ||
              !current.display.get(aircraft.deviceId)
            }
            aria-label={
              following ? "退出跟随" : `跟随${aircraft?.name || "航空器"}`
            }
            aria-pressed={following}
            className={following ? "active" : ""}
            title={
              following
                ? "退出视角跟随，自由浏览地图"
                : `锁定${aircraft?.name || "航空器"}视角，拖动地图可退出`
            }
            onClick={toggleFollow}
          >
            <Navigation size={13} />
            <span>{following ? "退出跟随" : "跟随"}</span>
          </button>
          <button
            type="button"
            disabled={!ready || failed || !activeCount}
            aria-label="飞行近览"
            title="切换三维视角，将全部已上报航迹置于视野中央"
            onClick={() => {
              request3D.current();
              follow.current = false;
              setFollowing(false);
              if (map && frameScene(map, current.display))
                setNotice("已恢复飞行近览 · 显示全部航迹");
            }}
          >
            <Crosshair size={13} />
            <span>飞行近览</span>
          </button>
          <button
            type="button"
            disabled={!ready || failed || !activeCount}
            aria-label="全市总览"
            title="拉远视野查看航迹所在区域，保留当前 2D / 3D 模式"
            onClick={overview}
          >
            <Scan size={13} />
            <span>全市总览</span>
          </button>
        </>
      )}
      <button
        type="button"
        className="flight-sim-power"
        aria-label={enabled ? "关闭飞行" : "开启飞行"}
        aria-pressed={enabled}
        title={
          enabled ? "隐藏航空器与航迹，地图仍可浏览" : "重新显示航空器与航迹"
        }
        onClick={toggleEnabled}
      >
        <Power size={13} />
        <span>{enabled ? "关闭" : "开启飞行"}</span>
      </button>
      <small
        className={`flight-sim-status${enabled && failed ? " flight-sim-error" : ""}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        title={feedback}
      >
        {feedback}
      </small>
    </div>
  );
}
