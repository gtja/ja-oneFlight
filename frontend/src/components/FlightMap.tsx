import { useEffect, useId, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, Geometry } from "geojson";
import {
  mapGeometryPoints,
  mapObjectGeometry,
  mapObjectLocation,
  objectCoordinates,
  type MapObjectLocation,
} from "./mapObjectFocus";
import { resolveDevicePresentation } from "../devicePresentation";
import {
  BUILDING_LAYER_IDS,
  BUILDING_SOURCE_ID,
  BUILDING_SOURCE_URL,
  buildingFromFeature,
  type MapBuilding,
} from "./mapBuildings";
import "./FlightMap.css";
import { ElevatedRouteLayer, ELEVATED_ROUTE_LAYER_ID } from "./elevatedRoute";
import { routeCloseupCamera, ROUTE_CLOSEUP_PITCH } from "./routeCamera";
import FlightSimulation3D from "./FlightSimulation3D";
import type {
  AircraftFlightDefinition,
  AircraftPositionReport,
} from "./flightReports";
export type { MapBuilding } from "./mapBuildings";
export type MapDrawing = {
  mode: "ROUTE" | "AIRSPACE";
  points: [number, number][];
  controls?: { point: [number, number]; label: string }[];
  innerRings?: [number, number][][];
  selectedIndex: number | null;
  heightMeters?: number[];
  showGroundProjection?: boolean;
  showCurtain?: boolean;
  showHeightLabels?: boolean;
  onTerrainStatus?: (status: { known: number; total: number }) => void;
  interaction?: "draw" | "inspect";
  focusRequest?: { index: number; revision: number };
  onSelect: (index: number) => void;
  onMove: (index: number, point: [number, number]) => void;
};
import {
  Crosshair,
  Minus,
  Plus,
  Scan,
  Building2,
  Drone,
  Warehouse,
  Camera,
  Radar,
  Cpu,
  Box,
  Route as RouteIcon,
  Hexagon,
} from "lucide-react";
import { useData, type Entity } from "../api";
const imagery =
  import.meta.env.VITE_IMAGERY_TILES ||
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const electronic =
  import.meta.env.VITE_ELECTRONIC_TILES ||
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const terrain =
  import.meta.env.VITE_TERRAIN_TILES ||
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
function mapStyle(
  satellite: boolean,
  config?: Entity,
  editing = false,
): StyleSpecification {
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: [
          satellite ? String(config?.mapSatelliteUrl || imagery) : electronic,
        ],
        tileSize: 256,
        attribution: satellite
          ? "Esri, Maxar, Earthstar Geographics"
          : "© OpenStreetMap contributors",
      },
      terrain: {
        type: "raster-dem",
        tiles: [String(config?.mapTerrainUrl || terrain)],
        tileSize: 256,
        encoding: "terrarium",
        maxzoom: 15,
        attribution: "AWS Terrain Tiles / Mapzen",
      },
    },
    layers: [
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: {
          "raster-saturation": satellite ? (editing ? -0.12 : -0.35) : -0.55,
          "raster-brightness-max": satellite ? (editing ? 0.9 : 0.72) : 0.38,
          "raster-contrast": satellite && editing ? 0.08 : 0,
          "raster-brightness-min": 0.05,
        },
      },
    ],
  };
}
function styleIdentity(
  satellite: boolean,
  config?: Entity,
  editing = false,
): string {
  return JSON.stringify([
    satellite,
    editing,
    satellite
      ? config?.mapSatelliteUrl || imagery
      : config?.mapStyleUrl || electronic,
    config?.mapTerrainUrl || terrain,
  ]);
}
function selectedStyle(satellite: boolean, config?: Entity, editing = false) {
  return !satellite && config?.mapStyleUrl
    ? String(config.mapStyleUrl)
    : mapStyle(satellite, config, editing);
}
export const coordinates = objectCoordinates;
const EMPTY_OBJECTS: Entity[] = [];
const EMPTY_LAYERS: Record<string, boolean> = {};
const BUSINESS_LAYER_IDS = ["business-fill", "business-hit", "business-line"];
const markerIcons = {
  AIRCRAFT: Drone,
  DOCK: Warehouse,
  CAMERA: Camera,
  RADAR: Radar,
  COMPUTE: Cpu,
  UNKNOWN: Box,
  ROUTE: RouteIcon,
  AIRSPACE: Hexagon,
};
export type AreaFocusRequest = {
  location: MapObjectLocation | null;
  revision: number;
};
const objectName = (entity: Entity) =>
  String(entity.title || entity.name || entity.deviceName || entity.id);
const motionDuration = (duration: number) =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? 0
    : duration;

/** Read inherited layout reservations without coupling the map to a parent DOM tree. */
function objectCameraPadding(container: HTMLElement) {
  const inherited = getComputedStyle(container);
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;height:0";
  container.append(probe);
  const reserved = (name: string, fallback = 48) => {
    const value = inherited.getPropertyValue(name).trim();
    if (!value) return fallback;
    probe.style.width = `var(${name})`;
    const measured = probe.getBoundingClientRect().width;
    const numeric = /^\d+(?:\.\d+)?px$/.test(value)
      ? Number.parseFloat(value)
      : 0;
    return Math.max(24, measured || numeric || fallback);
  };
  let left = reserved("--board-left"),
    right = reserved("--board-focus-right", reserved("--board-right"));
  let top = reserved("--board-top"),
    bottom = reserved("--board-bottom");
  if (inherited.getPropertyValue("--board-top").trim()) {
    const controls = container.parentElement
      ?.querySelector(".flight-sim-controls")
      ?.getBoundingClientRect();
    if (controls?.height)
      top = Math.max(
        top,
        controls.bottom - container.getBoundingClientRect().top + 24,
      );
  }
  probe.remove();
  const width = container.clientWidth || 1000,
    height = container.clientHeight || 600;
  // Preserve a usable map viewport even when the side panels stack on narrow screens.
  const horizontal = Math.min(
    1,
    Math.max(0, width - Math.min(240, width * 0.5)) / (left + right),
  );
  const vertical = Math.min(
    1,
    Math.max(0, height - Math.min(180, height * 0.5)) / (top + bottom),
  );
  left *= horizontal;
  right *= horizontal;
  top *= vertical;
  bottom *= vertical;
  return { left, right, top, bottom };
}
export default function FlightMap({
  objects = EMPTY_OBJECTS,
  onSelect,
  compact = false,
  initialThreeD,
  layers = EMPTY_LAYERS,
  onMapPoint,
  focusObject,
  selectedObjectId,
  focusRequest,
  areaFocusRequest,
  onResetView,
  drawing,
  onBuildingSelect,
  selectedBuildingId,
  selectedBuilding,
  simulation = false,
  flightReports,
  aircraftDefinitions,
  flightStreamKey,
}: {
  objects?: Entity[];
  focusObject?: Entity;
  selectedObjectId?: string;
  focusRequest?: { entity: Entity; revision: number };
  areaFocusRequest?: AreaFocusRequest;
  onResetView?: () => void;
  onSelect?: (entity: Entity) => void;
  compact?: boolean;
  initialThreeD?: boolean;
  layers?: Record<string, boolean>;
  onMapPoint?: (point: [number, number]) => void;
  drawing?: MapDrawing;
  onBuildingSelect?: (building: MapBuilding) => void;
  selectedBuildingId?: string;
  selectedBuilding?: MapBuilding;
  simulation?: boolean;
  flightReports?: readonly AircraftPositionReport[];
  aircraftDefinitions?: readonly AircraftFlightDefinition[];
  flightStreamKey?: string;
}) {
  const hasFlightScene = simulation || flightReports !== undefined;
  const markerPrefix = useId();
  const focusedAreaRevision = useRef<number | null>(null);
  const config = useData<Entity>("/config");
  const editing = Boolean(drawing);
  const holder = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const objectElements = useRef(new Map<string, HTMLButtonElement>());
  const businessFeatures = useRef<Feature[]>([]);
  const drawingMarkers = useRef<maplibregl.Marker[]>([]);
  const elevatedRoute = useRef<ElevatedRouteLayer | null>(null);
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;
  const [clickedBuilding, setClickedBuilding] = useState<MapBuilding>();
  const renderHeightById = useRef(new Map<string, number>());
  const buildingHandler = useRef(onBuildingSelect);
  buildingHandler.current = onBuildingSelect;
  const [buildingsVisible, setBuildingsVisible] = useState(true);
  const buildingsVisibleRef = useRef(buildingsVisible);
  buildingsVisibleRef.current = buildingsVisible;
  const [buildingStatus, setBuildingStatus] = useState("放大至街区查看楼宇");
  const buildingError = useRef(false);
  const autoFitDone = useRef(false);
  const focusedDrawingRevision = useRef<number | null>(null);
  const [satellite, setSatellite] = useState(true);
  const [routeView, setRouteView] = useState<"closeup" | "overview">(
    drawing?.mode === "ROUTE" ? "closeup" : "overview",
  );
  const [threeD, setThreeD] = useState(
    initialThreeD ?? (drawing?.mode === "ROUTE" || (!onMapPoint && !drawing)),
  );
  const pointHandler = useRef(onMapPoint);
  pointHandler.current = onMapPoint;
  const [failure, setFailure] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [styleEpoch, setStyleEpoch] = useState(0);
  const activeStyle = useRef("");
  const focusedId = useRef<string | null>(null);
  const focusedObjectRevision = useRef<number | null>(null);
  const selectHandler = useRef(onSelect);
  selectHandler.current = onSelect;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const objectLayersRef = useRef(layers);
  objectLayersRef.current = layers;
  const selectedObjectRef = useRef(selectedObjectId);
  selectedObjectRef.current = selectedObjectId;
  const [objectHover, setObjectHover] = useState<{
    entity: Entity;
    x: number;
    y: number;
  }>();
  const styleReady = useRef(false);
  const terrainTiles = useRef(terrain);
  terrainTiles.current = String(config.data?.mapTerrainUrl || terrain);
  function closeupDrawing(index = drawingRef.current?.selectedIndex ?? 0) {
    const m = map.current;
    const current = drawingRef.current;
    if (!m || !current || current.mode !== "ROUTE") return;
    const camera = routeCloseupCamera(
      current.points,
      current.heightMeters,
      index,
      {
        width: holder.current?.clientWidth || 1000,
        height: holder.current?.clientHeight || 600,
      },
    );
    if (!camera) return;
    setRouteView("closeup");
    setThreeD(true);
    m.flyTo({ ...camera, duration: motionDuration(camera.duration ?? 450) });
  }
  function fitDrawing() {
    const m = map.current;
    const points = drawingRef.current?.points || [];
    if (!m || !points.length) return;
    setRouteView("overview");
    const lngs = points.map((point) => point[0]);
    const lats = points.map((point) => point[1]);
    m.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: 72,
        maxZoom: 17,
        duration: motionDuration(450),
        bearing: -10,
        pitch: threeD ? 55 : 0,
      },
    );
  }
  useEffect(() => {
    if (!holder.current) return;
    let disposed = false;
    styleReady.current = false;
    activeStyle.current = styleIdentity(satellite, config.data, editing);
    setLoaded(false);
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: holder.current,
        style: selectedStyle(satellite, config.data, editing),
        center: [120.155, 30.27],
        zoom: 11.2,
        pitch:
          initialThreeD === false
            ? 0
            : drawing?.mode === "ROUTE"
              ? ROUTE_CLOSEUP_PITCH
              : !onMapPoint && !drawing
                ? 55
                : 0,
        bearing: -10,
        attributionControl: { compact: true },
      });
    } catch {
      setFailure("浏览器暂不支持 WebGL 地图");
      return;
    }
    map.current = m;
    if (onMapPoint || drawing) {
      m.doubleClickZoom.disable();
      m.getCanvas().style.cursor = "crosshair";
    }
    const onClick = (event: maplibregl.MapMouseEvent) => {
      if (disposed || map.current !== m) return;
      if (event.originalEvent.target !== m.getCanvas()) return;
      if (drawingRef.current?.interaction === "inspect") {
        if (!buildingsVisibleRef.current) return;
        const available = BUILDING_LAYER_IDS.filter((id) => m.getLayer(id));
        const feature = available.length
          ? m.queryRenderedFeatures(event.point, { layers: available })[0]
          : undefined;
        if (feature) {
          const building = buildingFromFeature(feature, [
            event.lngLat.lng,
            event.lngLat.lat,
          ]);
          if (building) {
            const renderHeight = Number(feature.properties?.render_height);
            if (Number.isFinite(renderHeight) && renderHeight >= 0)
              renderHeightById.current.set(building.id, renderHeight);
            setClickedBuilding(building);
            buildingHandler.current?.(building);
          }
        }
        return;
      }
      if (!drawingRef.current && !pointHandler.current) {
        const entity = pickedObject(event.point);
        if (entity) {
          setObjectHover(undefined);
          selectHandler.current?.(entity);
        }
        return;
      }
      pointHandler.current?.([event.lngLat.lng, event.lngLat.lat]);
    };
    const pickedObject = (point: maplibregl.PointLike) => {
      if (
        !styleReady.current ||
        objectLayersRef.current.airspace === false ||
        !selectHandler.current
      )
        return;
      const available = BUSINESS_LAYER_IDS.filter((id) => m.getLayer(id));
      if (!available.length) return;
      const feature = m
        .queryRenderedFeatures(point, { layers: available })
        .find(
          (candidate) =>
            candidate.source === "business" &&
            BUSINESS_LAYER_IDS.includes(candidate.layer.id) &&
            typeof candidate.properties?.id === "string" &&
            objectsRef.current.some(
              (entity) =>
                entity.id === candidate.properties.id &&
                ["AIRSPACE", "ROUTE"].includes(String(entity.kind)),
            ),
        );
      return feature
        ? objectsRef.current.find(
            (entity) => entity.id === feature.properties.id,
          )
        : undefined;
    };
    const onMouseMove = (event: maplibregl.MapMouseEvent) => {
      if (
        disposed ||
        map.current !== m ||
        drawingRef.current ||
        pointHandler.current
      )
        return;
      const entity = pickedObject(event.point);
      m.getCanvas().style.cursor = entity ? "pointer" : "";
      setObjectHover((previous) =>
        entity
          ? previous?.entity.id === entity.id
            ? previous
            : {
                entity,
                x: Math.min(
                  event.point.x,
                  (holder.current?.clientWidth || 1000) - 270,
                ),
                y: Math.max(90, event.point.y),
              }
          : undefined,
      );
    };
    const clearObjectHover = () => {
      if (disposed || drawingRef.current || pointHandler.current) return;
      m.getCanvas().style.cursor = "";
      setObjectHover(undefined);
    };
    const onStyleLoad = () => {
      if (disposed || map.current !== m) return;
      styleReady.current = true;
      buildingError.current = false;
      if (!m.getSource("terrain")) {
        m.addSource("terrain", {
          type: "raster-dem",
          tiles: [terrainTiles.current],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 15,
        });
      }
      if (drawingRef.current) {
        if (!m.getSource(BUILDING_SOURCE_ID)) {
          m.addSource(BUILDING_SOURCE_ID, {
            type: "vector",
            url: BUILDING_SOURCE_URL,
          });
        }
        m.addLayer({
          id: BUILDING_LAYER_IDS[0],
          type: "fill",
          source: BUILDING_SOURCE_ID,
          "source-layer": "building",
          minzoom: 14,
          paint: {
            "fill-color": "#b3b8aa",
            "fill-opacity": 0.32,
            "fill-outline-color": "#e2dcc2",
          },
        });
        m.addLayer({
          id: BUILDING_LAYER_IDS[1],
          type: "fill-extrusion",
          source: BUILDING_SOURCE_ID,
          "source-layer": "building",
          minzoom: 14,
          filter: ["!=", ["get", "hide_3d"], true],
          paint: {
            "fill-extrusion-color": "#b3b8aa",
            "fill-extrusion-opacity": 0.7,
            "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
            "fill-extrusion-base": [
              "coalesce",
              ["get", "render_min_height"],
              0,
            ],
          },
        });
      }
      setFailure("");
      setLoaded(true);
      setStyleEpoch((epoch) => epoch + 1);
    };
    const onError = (event: maplibregl.ErrorEvent) => {
      if (disposed || map.current !== m) return;
      if ("sourceId" in event && event.sourceId === BUILDING_SOURCE_ID) {
        buildingError.current = true;
        setBuildingStatus("楼宇数据暂不可用");
        return;
      }
      setFailure("部分地图资源加载失败，可切换底图重试");
    };
    const onBuildingData = () => {
      if (
        disposed ||
        map.current !== m ||
        !drawingRef.current ||
        !styleReady.current
      )
        return;
      if (buildingError.current) return;
      if (m.getZoom() < 14) setBuildingStatus("放大至街区查看楼宇");
      else if (
        m.getSource(BUILDING_SOURCE_ID) &&
        m.isSourceLoaded(BUILDING_SOURCE_ID)
      ) {
        const available = BUILDING_LAYER_IDS.filter((id) => m.getLayer(id));
        const count = available.length
          ? m.queryRenderedFeatures({ layers: available }).length
          : 0;
        setBuildingStatus(count ? "楼宇轮廓已加载" : "当前视野暂无楼宇轮廓");
      } else setBuildingStatus("楼宇数据加载中");
    };
    m.on("click", onClick);
    m.on("mousemove", onMouseMove);
    m.getCanvas().addEventListener("mouseleave", clearObjectHover);
    m.on("movestart", clearObjectHover);
    m.on("style.load", onStyleLoad);
    m.on("error", onError);
    m.on("idle", onBuildingData);
    m.on("zoomend", onBuildingData);
    const resize = new ResizeObserver(() => {
      if (!disposed && map.current === m) m.resize();
    });
    resize.observe(holder.current);
    return () => {
      disposed = true;
      styleReady.current = false;
      map.current = null;
      resize.disconnect();
      m.off("click", onClick);
      m.off("mousemove", onMouseMove);
      m.getCanvas().removeEventListener("mouseleave", clearObjectHover);
      m.off("movestart", clearObjectHover);
      m.off("style.load", onStyleLoad);
      m.off("error", onError);
      m.off("idle", onBuildingData);
      m.off("zoomend", onBuildingData);
      markers.current.forEach((x) => x.remove());
      markers.current = [];
      drawingMarkers.current.forEach((marker) => marker.remove());
      drawingMarkers.current = [];
      m.stop();
      if (m.getTerrain()) m.setTerrain(null);
      m.remove();
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const styleKey = styleIdentity(satellite, config.data, editing);
    if (activeStyle.current === styleKey) return;
    activeStyle.current = styleKey;
    m.stop();
    // MapLibre 5 may render outgoing terrain before the new style has a projection.
    // Dispose that terrain before setStyle; style.load restores the selected 3D mode.
    if (m.getTerrain()) m.setTerrain(null);
    styleReady.current = false;
    setLoaded(false);
    setFailure("");
    m.setStyle(selectedStyle(satellite, config.data, editing), {
      diff: false,
    });
  }, [satellite, config.data, editing]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !styleReady.current || !m.getSource("terrain")) return;
    m.setTerrain(
      threeD
        ? {
            source: "terrain",
            exaggeration: drawing?.mode === "ROUTE" ? 1 : 1.3,
          }
        : null,
    );
    if (drawingRef.current?.mode === "ROUTE" && !threeD)
      setRouteView("overview");
    // The flight scene owns its close-up and follow camera transitions.
    if (hasFlightScene) return;
    m.easeTo({
      pitch: threeD
        ? drawingRef.current?.mode === "ROUTE"
          ? ROUTE_CLOSEUP_PITCH
          : 55
        : 0,
      duration: motionDuration(450),
    });
  }, [threeD, loaded, styleEpoch, hasFlightScene]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !styleReady.current || !drawing) return;
    m.getCanvas().style.cursor =
      drawing.interaction === "inspect" ? "pointer" : "crosshair";
    BUILDING_LAYER_IDS.forEach((id, index) => {
      if (!m.getLayer(id)) return;
      m.setLayoutProperty(
        id,
        "visibility",
        buildingsVisible && (threeD ? index === 1 : index === 0)
          ? "visible"
          : "none",
      );
    });
  }, [drawing, threeD, buildingsVisible, loaded, styleEpoch]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !styleReady.current || !drawing) return;
    const building =
      selectedBuilding ||
      (clickedBuilding &&
      (!selectedBuildingId || clickedBuilding.id === selectedBuildingId)
        ? clickedBuilding
        : undefined);
    const outline = building?.outline;
    const height = building
      ? (renderHeightById.current.get(building.id) ??
        building.heightMeters ??
        0)
      : 0;
    const data = {
      type: "FeatureCollection" as const,
      features:
        outline && outline.length >= 4
          ? [
              {
                type: "Feature" as const,
                geometry: { type: "Polygon" as const, coordinates: [outline] },
                properties: { height },
              },
            ]
          : [],
    };
    const existing = m.getSource("selected-building") as
      maplibregl.GeoJSONSource | undefined;
    if (existing) existing.setData(data);
    else {
      m.addSource("selected-building", { type: "geojson", data });
      m.addLayer({
        id: "selected-building-fill",
        type: "fill",
        source: "selected-building",
        paint: { "fill-color": "#ffc56b", "fill-opacity": 0.42 },
      });
      m.addLayer({
        id: "selected-building-extrusion",
        type: "fill-extrusion",
        source: "selected-building",
        paint: {
          "fill-extrusion-color": "#ffc56b",
          "fill-extrusion-opacity": 0.85,
          "fill-extrusion-height": ["get", "height"],
        },
      });
      m.addLayer({
        id: "selected-building-line",
        type: "line",
        source: "selected-building",
        paint: { "line-color": "#ffe2a2", "line-width": 3 },
      });
    }
    m.setLayoutProperty(
      "selected-building-fill",
      "visibility",
      buildingsVisible && !threeD ? "visible" : "none",
    );
    m.setLayoutProperty(
      "selected-building-extrusion",
      "visibility",
      buildingsVisible && threeD ? "visible" : "none",
    );
    m.setLayoutProperty(
      "selected-building-line",
      "visibility",
      buildingsVisible ? "visible" : "none",
    );
  }, [
    selectedBuilding,
    selectedBuildingId,
    clickedBuilding,
    drawing,
    buildingsVisible,
    threeD,
    loaded,
    styleEpoch,
  ]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !styleReady.current || !drawing) return;
    drawingMarkers.current.forEach((marker) => marker.remove());
    drawingMarkers.current = [];
    const points = drawing.points;
    const geometry: Geometry | null =
      drawing.mode === "AIRSPACE" && points.length >= 3
        ? {
            type: "Polygon",
            coordinates: [
              [...points, points[0]],
              ...(drawing.innerRings || []),
            ],
          }
        : points.length >= 2
          ? { type: "LineString", coordinates: points }
          : null;
    const data = {
      type: "FeatureCollection" as const,
      features: geometry
        ? [{ type: "Feature" as const, geometry, properties: {} }]
        : [],
    };
    const existing = m.getSource("drawing") as
      maplibregl.GeoJSONSource | undefined;
    if (existing) existing.setData(data);
    else {
      m.addSource("drawing", { type: "geojson", data });
      m.addLayer({
        id: "drawing-fill",
        type: "fill",
        source: "drawing",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#49d8ff", "fill-opacity": 0.16 },
      });
      m.addLayer({
        id: "drawing-casing",
        type: "line",
        source: "drawing",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#063c2d",
          "line-width": 8,
          "line-opacity": 0.95,
        },
      });
      m.addLayer({
        id: "drawing-line",
        type: "line",
        source: "drawing",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#16e6a7", "line-width": 4 },
      });
    }
    const elevated = threeD && drawing.mode === "ROUTE";
    ["drawing-line", "drawing-casing"].forEach((id) => {
      if (m.getLayer(id))
        m.setLayoutProperty(id, "visibility", elevated ? "none" : "visible");
    });
    if (elevated) {
      if (!m.getLayer(ELEVATED_ROUTE_LAYER_ID)) {
        elevatedRoute.current = new ElevatedRouteLayer(drawing);
        m.addLayer(elevatedRoute.current);
      } else elevatedRoute.current?.setDrawing(drawing);
    } else if (m.getLayer(ELEVATED_ROUTE_LAYER_ID)) {
      m.removeLayer(ELEVATED_ROUTE_LAYER_ID);
      elevatedRoute.current = null;
    }
    if (!elevated)
      (
        drawing.controls ?? points.map((point) => ({ point, label: "" }))
      ).forEach(({ point, label }, index) => {
        const element = document.createElement("button");
        element.type = "button";
          element.className = `drawing-waypoint${label ? " shape-control" : ""}${index === drawing.selectedIndex ? " selected" : ""}${drawing.mode === "ROUTE" ? (index === 0 ? " first" : index === points.length - 1 ? " last" : "") : ""}`;
        element.textContent = label || String(index + 1);
        const suffix =
          drawing.mode !== "ROUTE"
            ? ""
            : index === 0
              ? " · 起点"
              : index === points.length - 1
                ? " · 终点"
                : "";
        element.setAttribute(
          "aria-label",
          `${label || `${drawing.mode === "ROUTE" ? "航点" : "边界点"} ${index + 1}${suffix}`}，可拖动调整`,
        );
        element.title = `${label || `${drawing.mode === "ROUTE" ? "航点" : "边界点"} ${index + 1}${suffix}`} · 拖动调整位置`;
        element.setAttribute(
          "aria-pressed",
          String(index === drawing.selectedIndex),
        );
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          drawingRef.current?.onSelect(index);
        });
        const marker = new maplibregl.Marker({ element, draggable: true })
          .setLngLat(point)
          .addTo(m);
        marker.on("dragend", () => {
          const location = marker.getLngLat();
          drawingRef.current?.onSelect(index);
          drawingRef.current?.onMove(index, [location.lng, location.lat]);
        });
        drawingMarkers.current.push(marker);
      });
    if (!autoFitDone.current && points.length) {
      autoFitDone.current = true;
      if (drawing.mode === "ROUTE" && threeD) closeupDrawing();
      else fitDrawing();
    }
  }, [drawing, threeD, loaded, styleEpoch]);
  useEffect(() => {
    const m = map.current;
    const request = drawing?.focusRequest;
    if (
      !m ||
      !loaded ||
      !styleReady.current ||
      !request ||
      focusedDrawingRevision.current === request.revision ||
      !Number.isInteger(request.index) ||
      request.index < 0
    )
      return;
    const point =
      drawing.controls?.[request.index]?.point ?? drawing.points[request.index];
    if (!point || !point.every(Number.isFinite)) return;
    if (drawing.mode === "ROUTE" && threeD) closeupDrawing(request.index);
    else
      m.flyTo({
        center: point,
        zoom: Math.max(m.getZoom(), 16),
        duration: motionDuration(450),
      });
    focusedDrawingRevision.current = request.revision;
  }, [drawing?.focusRequest, drawing?.points, loaded, styleEpoch, threeD]);
  useEffect(() => {
    if (
      !loaded ||
      !map.current ||
      !focusObject ||
      focusedId.current === focusObject.id
    )
      return;
    const location = mapObjectLocation(focusObject);
    if (!location) return;
    if ("bounds" in location) {
      map.current.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
      map.current.fitBounds(location.bounds, {
        padding: 48,
        maxZoom: 16,
        duration: motionDuration(500),
      });
    } else {
      map.current.flyTo({
        center: location.point,
        zoom: 14,
        duration: motionDuration(500),
      });
    }
    focusedId.current = focusObject.id;
  }, [loaded, focusObject]);
  useEffect(() => {
    const m = map.current;
    if (
      !m ||
      !loaded ||
      !styleReady.current ||
      !focusRequest ||
      !holder.current ||
      focusedObjectRevision.current === focusRequest.revision
    )
      return;
    const location = mapObjectLocation(focusRequest.entity);
    if (!location) return;
    const eventData = { businessObjectFocus: true };
    m.stop();
    // MapLibre retains flyTo padding and cameraForBounds adds it to the requested
    // insets. Clear it before calculating a new camera; `retainPadding` is not a
    // MapLibre option. Use an offset for point cameras so no insets accumulate.
    m.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }, eventData);
    const padding = objectCameraPadding(holder.current);
    const options = {
      duration: motionDuration(650),
      pitch: m.getPitch(),
      bearing: m.getBearing(),
    };
    if ("bounds" in location) {
      const camera = m.cameraForBounds(location.bounds, {
        padding,
        bearing: options.bearing,
        maxZoom: 15.5,
      });
      if (!camera) return;
      m.flyTo({ ...camera, ...options }, eventData);
    } else
      m.flyTo(
        {
          ...options,
          center: location.point,
          zoom: Math.max(14, m.getZoom()),
          offset: [
            (padding.left - padding.right) / 2,
            (padding.top - padding.bottom) / 2,
          ],
        },
        eventData,
      );
    focusedObjectRevision.current = focusRequest.revision;
  }, [focusRequest, loaded, styleEpoch]);
  useEffect(() => {
    const m = map.current;
    if (
      !m ||
      !loaded ||
      !styleReady.current ||
      !areaFocusRequest ||
      drawing ||
      hasFlightScene ||
      focusedAreaRevision.current === areaFocusRequest.revision
    )
      return;
    m.stop();
    m.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    const location = areaFocusRequest.location;
    const options = { duration: motionDuration(650), bearing: -10 };
    if (!location) {
      m.flyTo({ ...options, center: [120.155, 30.27], zoom: 11.2 });
    } else if ("bounds" in location) {
      const camera = m.cameraForBounds(location.bounds, {
        padding: holder.current
          ? objectCameraPadding(holder.current)
          : { top: 48, right: 48, bottom: 48, left: 48 },
        bearing: -10,
        maxZoom: 14,
      });
      if (!camera) return;
      m.flyTo({ ...camera, ...options });
    } else {
      m.flyTo({ ...options, center: location.point, zoom: 14 });
    }
    focusedAreaRevision.current = areaFocusRequest.revision;
  }, [areaFocusRequest, loaded, styleEpoch, drawing, hasFlightScene]);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !styleReady.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    objectElements.current.clear();
    setObjectHover(undefined);
    if (!drawing && !onMapPoint) m.getCanvas().style.cursor = "";
    const addMarker = (
      entity: Entity,
      point: [number, number],
      kind: string,
      geometry = false,
    ) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `map-marker${geometry ? " map-geometry-marker" : ""}`;
      element.dataset.entityId = entity.id;
      element.setAttribute("aria-label", objectName(entity));
      element.setAttribute(
        "aria-pressed",
        String(entity.id === selectedObjectRef.current),
      );
      element.classList.toggle(
        "selected",
        entity.id === selectedObjectRef.current,
      );
      element.title = `${objectName(entity)} · ${kind === "AIRSPACE" ? "查看空域" : kind === "ROUTE" ? "查看航线" : "查看对象"}`;
      element.tabIndex = selectHandler.current ? 0 : -1;
      element.setAttribute("aria-disabled", String(!selectHandler.current));
      const presentation = resolveDevicePresentation(entity);
      element.title = `${objectName(entity)} · ${geometry ? (kind === "ROUTE" ? "查看航线" : "查看空域") : presentation.label}`;
      const symbol = document.createElement("span");
      symbol.setAttribute("aria-hidden", "true");
      const iconName = geometry
        ? kind === "ROUTE"
          ? "ROUTE"
          : "AIRSPACE"
        : presentation.category;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "15");
      svg.setAttribute("height", "15");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", `#${markerPrefix}-${iconName}`);
      svg.append(use);
      symbol.append(svg);
      const caption = document.createElement("small");
      caption.textContent = objectName(entity);
      element.append(symbol, caption);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        selectHandler.current?.(entity);
      });
      objectElements.current.set(entity.id, element);
      markers.current.push(
        new maplibregl.Marker({ element }).setLngLat(point).addTo(m),
      );
    };
    for (const entity of objects) {
      if (entity.kind === "AIRSPACE" || entity.kind === "ROUTE") continue;
      const presentation = resolveDevicePresentation(entity);
      const point = coordinates(entity);
      if (!point) continue;
      if (layers[presentation.layer] === false) continue;
      addMarker(entity, point, presentation.rawType || "DEVICE");
    }
    const features: Feature[] = [];
    objects
      .filter((entity) => ["AIRSPACE", "ROUTE"].includes(String(entity.kind)))
      .forEach((entity) => {
        const geometry = mapObjectGeometry(entity);
        if (!geometry) return;
        features.push({
          type: "Feature",
          geometry,
          properties: {
            id: entity.id,
            title: objectName(entity),
            kind: entity.kind,
            selected: entity.id === selectedObjectRef.current,
            hovered: false,
          },
        });
        // A label at an actual source vertex provides keyboard access to canvas geometry.
        if (
          layers.airspace !== false &&
          !drawing &&
          !onMapPoint &&
          selectHandler.current
        ) {
          const points = mapGeometryPoints(geometry);
          addMarker(
            entity,
            points[Math.floor((points.length - 1) / 2)],
            String(entity.kind),
            true,
          );
        }
      });
    businessFeatures.current = features;
    const source = m.getSource("business") as
      maplibregl.GeoJSONSource | undefined;
    if (source) source.setData({ type: "FeatureCollection", features });
    else {
      m.addSource("business", {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      m.addLayer({
        id: "business-fill",
        type: "fill",
        source: "business",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#71d7e8",
            ["==", ["get", "hovered"], true],
            "#59bed5",
            "#3d9dbd",
          ],
          "fill-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            0.23,
            ["==", ["get", "hovered"], true],
            0.17,
            0.1,
          ],
          "fill-opacity-transition": { duration: motionDuration(220) },
        },
      });
      m.addLayer({
        id: "business-hit",
        type: "line",
        source: "business",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#6dc6da", "line-width": 14, "line-opacity": 0 },
      });
      m.addLayer({
        id: "business-line",
        type: "line",
        source: "business",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "selected"], true],
            "#b0f3ff",
            ["==", ["get", "hovered"], true],
            "#9be8f6",
            "#6dc6da",
          ],
          "line-width": [
            "case",
            ["==", ["get", "selected"], true],
            3,
            ["==", ["get", "hovered"], true],
            2.5,
            1.5,
          ],
          "line-dasharray": [4, 3],
          "line-width-transition": { duration: motionDuration(220) },
        },
      });
    }
    BUSINESS_LAYER_IDS.forEach((id) =>
      m.setLayoutProperty(
        id,
        "visibility",
        layers.airspace === false ? "none" : "visible",
      ),
    );
  }, [
    objects,
    loaded,
    layers,
    satellite,
    styleEpoch,
    drawing,
    onMapPoint,
    Boolean(onSelect),
    markerPrefix,
  ]);
  useEffect(() => {
    objectElements.current.forEach((element, id) => {
      const selected = id === selectedObjectId;
      element.classList.toggle("selected", selected);
      element.setAttribute("aria-pressed", String(selected));
    });
    const source = map.current?.getSource("business") as
      maplibregl.GeoJSONSource | undefined;
    if (!source || !loaded || !styleReady.current) return;
    businessFeatures.current = businessFeatures.current.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        selected: feature.properties?.id === selectedObjectId,
        hovered: feature.properties?.id === objectHover?.entity.id,
      },
    }));
    source.setData({
      type: "FeatureCollection",
      features: businessFeatures.current,
    });
  }, [
    selectedObjectId,
    objectHover?.entity.id,
    objects,
    layers,
    loaded,
    styleEpoch,
  ]);
  return (
    <div
      className={`flight-map ${compact ? "compact" : ""}${drawing ? " flight-map-editing" : ""}`}
    >
      <svg
        className="map-icon-definitions"
        aria-hidden="true"
        width="0"
        height="0"
      >
        <defs>
          {Object.entries(markerIcons).map(([name, Icon]) => (
            <symbol
              key={name}
              id={`${markerPrefix}-${name}`}
              viewBox="0 0 24 24"
            >
              <Icon size={24} />
            </symbol>
          ))}
        </defs>
      </svg>
      <div ref={holder} className="map-canvas" />
      {hasFlightScene && (
        <FlightSimulation3D
          map={map.current}
          ready={loaded}
          styleEpoch={styleEpoch}
          threeD={threeD}
          onRequest3D={() => setThreeD(true)}
          reports={flightReports}
          definitions={aircraftDefinitions}
          streamKey={flightStreamKey}
        />
      )}
      {failure && <div className="map-failure">{failure}</div>}
      {objectHover && (
        <div
          className="map-object-tooltip"
          role="tooltip"
          style={{ left: objectHover.x, top: objectHover.y }}
        >
          <strong>{objectName(objectHover.entity)}</strong>
          <span>
            {objectHover.entity.kind === "ROUTE" ? "航线" : "空域"} · 点击查看
          </span>
        </div>
      )}
      <div className="map-tools" role="group" aria-label="地图视图控制">
        <div>
          <button
            type="button"
            aria-pressed={!threeD}
            title="切换二维俯视地图"
            className={!threeD ? "active" : ""}
            onClick={() => {
              setThreeD(false);
              if (hasFlightScene)
                map.current?.easeTo({
                  pitch: 0,
                  duration: motionDuration(450),
                });
            }}
          >
            2D
          </button>
          <button
            type="button"
            aria-pressed={threeD}
            title="切换三维地形视图"
            className={threeD ? "active" : ""}
            onClick={() => {
              setThreeD(true);
              if (hasFlightScene)
                map.current?.easeTo({
                  pitch: 60,
                  duration: motionDuration(450),
                });
              if (drawingRef.current?.mode === "ROUTE") closeupDrawing();
            }}
          >
            3D
          </button>
        </div>
        <div>
          <button
            type="button"
            aria-pressed={!satellite}
            title="切换电子地图底图"
            className={!satellite ? "active" : ""}
            onClick={() => setSatellite(false)}
          >
            电子图
          </button>
          <button
            type="button"
            aria-pressed={satellite}
            title="切换卫星影像底图"
            className={satellite ? "active" : ""}
            onClick={() => setSatellite(true)}
          >
            影像
          </button>
        </div>
        {drawing && (
          <div>
            <button
              type="button"
              aria-pressed={buildingsVisible}
              className={buildingsVisible ? "active" : ""}
              onClick={() => setBuildingsVisible((visible) => !visible)}
              title="OpenFreeMap / OpenStreetMap 楼宇轮廓"
            >
              楼宇
            </button>
            {drawing.mode === "ROUTE" && (
              <button
                type="button"
                disabled={!drawing.points.length}
                onClick={() => closeupDrawing()}
                aria-pressed={routeView === "closeup" && threeD}
                className={routeView === "closeup" && threeD ? "active" : ""}
                title="近距离观察所选航点及相邻航段的真实高度"
              >
                <Crosshair size={13} />
                立体近览
              </button>
            )}
            <button
              type="button"
              disabled={!drawing.points.length}
              onClick={fitDrawing}
              aria-pressed={routeView === "overview"}
              className={routeView === "overview" ? "active" : ""}
              title={
                drawing.mode === "AIRSPACE"
                  ? "查看全部边界点范围"
                  : "查看全部航点范围；近距离看高度请用立体近览"
              }
            >
              <Scan size={13} />
              {drawing.mode === "AIRSPACE" ? "范围总览" : "全线总览"}
            </button>
          </div>
        )}
        <div className="round">
          <button
            type="button"
            aria-label="放大"
            title="放大地图"
            onClick={() =>
              map.current?.zoomIn({ duration: motionDuration(250) })
            }
          >
            <Plus size={17} />
          </button>
          <button
            type="button"
            aria-label="缩小"
            title="缩小地图"
            onClick={() =>
              map.current?.zoomOut({ duration: motionDuration(250) })
            }
          >
            <Minus size={17} />
          </button>
          <button
            type="button"
            aria-label={onResetView ? "恢复当前区域视角" : "恢复杭州视角"}
            title={onResetView ? "恢复当前区域视角" : "恢复杭州全域视角"}
            onClick={() =>
              onResetView
                ? onResetView()
                : map.current?.flyTo({
                    center: [120.155, 30.27],
                    zoom: 11.2,
                    bearing: -10,
                    duration: motionDuration(650),
                  })
            }
          >
            <Crosshair size={16} />
          </button>
        </div>
      </div>
      {drawing?.mode === "ROUTE" && (
        <div className="map-camera-mode" aria-live="polite">
          {routeView === "closeup" && threeD ? "局部高度视图" : "全线范围视图"}
        </div>
      )}
      {drawing && (
        <div className="map-building-status" role="status">
          <Building2 size={12} />
          {buildingsVisible ? buildingStatus : "楼宇图层已隐藏"}
        </div>
      )}
      <div className="map-watermark">
        杭州 · WGS84
        <span>
          {hasFlightScene ? "城市低空运行态势" : "坐标与状态以来源观测为准"}
        </span>
      </div>
    </div>
  );
}
