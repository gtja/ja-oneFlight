import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Building2,
  Check,
  Maximize2,
  MousePointer2,
  Plus,
  RotateCcw,
  Route,
  Trash2,
  Undo2,
} from "lucide-react";
import FlightMap, { type MapBuilding } from "./FlightMap";
import { Modal } from "./UI";
import SelectControl from "./SelectControl";
import AirspaceShapeFields from "./AirspaceShapeFields";
import {
  airspaceShapeHandles,
  airspaceShapePoints,
  inferAirspaceShape,
  moveAirspaceShape,
  type AirspaceShape,
} from "../airspaceShapes";
import type { AirspaceProfile } from "../api/types";
import {
  drawGeometry,
  ensureRouteFlightProfile,
  geometryPositions,
  geometryInnerRings,
  airspaceProfileError,
  airspaceHeightLabel,
  isRouteHeightMeters,
  MAX_ROUTE_HEIGHT_METERS,
  removeGeometryAssociation,
  removeGeometryPoint,
  routeLengthMeters,
  sanitizeGeometryContext,
  setRouteFlightHeight,
  setRouteWaypointHeight,
  updateGeometryPoint,
  type GeometryContext,
  type GeometryPosition,
} from "../geometry";
import "./GeometryInput.css";

export function AirspaceProfileInput({
  value,
  onChange,
  disabled = false,
}: {
  value?: unknown;
  onChange: (value: AirspaceProfile) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const profile =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const change = (
    key: keyof AirspaceProfile,
    next: AirspaceProfile[keyof AirspaceProfile],
  ) =>
    onChange({
      reference: profile.reference ?? null,
      lowerHeightMeters: profile.lowerHeightMeters ?? null,
      upperHeightMeters: profile.upperHeightMeters ?? null,
      [key]: next,
    } as AirspaceProfile);
  const error = airspaceProfileError(value);
  return (
    <fieldset className="airspace-profile" disabled={disabled}>
      <legend>空域高度范围</legend>
      <label htmlFor={`${id}-reference`}>高度基准</label>
      <SelectControl
        id={`${id}-reference`}
        value={String(profile.reference ?? "")}
        disabled={disabled}
        options={[
          { value: "", label: "未明确" },
          { value: "AGL", label: "离地高度（AGL）" },
          { value: "AMSL", label: "海拔高度（AMSL）" },
        ]}
        onChange={(reference) =>
          change(
            "reference",
            reference === "AGL" || reference === "AMSL" ? reference : null,
          )
        }
      />
      <div className="airspace-height-limits">
        {(
          [
            ["lowerHeightMeters", "高度下限（米）"],
            ["upperHeightMeters", "高度上限（米）"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              step="any"
              min={profile.reference === "AGL" ? 0 : undefined}
              value={profile[key] == null ? "" : String(profile[key])}
              placeholder="未明确"
              aria-describedby={`${id}-hint`}
              onChange={(event) =>
                change(
                  key,
                  event.currentTarget.value === ""
                    ? null
                    : Number(event.currentTarget.value),
                )
              }
            />
          </label>
        ))}
      </div>
      <small id={`${id}-hint`}>
        未填写的高度保持未明确；独立保存，不使用来源坐标高程。
      </small>
      {error && (
        <p className="geometry-coordinate-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export default function GeometryInput({
  value,
  context,
  mode,
  onChange,
  onContextChange,
  airspaceProfile,
  onAirspaceProfileChange,
}: {
  value: unknown;
  context?: unknown;
  mode: "ROUTE" | "AIRSPACE";
  onChange: (value: unknown) => void;
  onContextChange?: (context: GeometryContext) => void;
  airspaceProfile?: unknown;
  onAirspaceProfileChange?: (profile: AirspaceProfile) => void;
}) {
  const [points, setPoints] = useState<GeometryPosition[]>(() =>
    geometryPositions(value, mode),
  );
  const sourceGeometry = useRef(value);
  const [relations, setRelations] = useState(() =>
    mode === "ROUTE"
      ? ensureRouteFlightProfile(context, points.length)
      : sanitizeGeometryContext(context, points.length),
  );
  const [shape, setShape] = useState<AirspaceShape | undefined>(() => {
    if (mode !== "AIRSPACE") return undefined;
    const saved = relations.airspaceShape;
    if (saved) {
      const restored = airspaceShapePoints(saved, points);
      if (
        restored.length === points.length &&
        restored.every(
          (position, index) =>
            Math.abs(position[0] - points[index][0]) < 1e-8 &&
            Math.abs(position[1] - points[index][1]) < 1e-8,
        )
      )
        return saved;
    }
    return inferAirspaceShape(points);
  });
  const [shapeTool, setShapeTool] = useState<"POLYGON" | AirspaceShape["type"]>(
    shape?.type ?? "POLYGON",
  );
  const [shapeAnchor, setShapeAnchor] = useState<[number, number]>();
  const [shapeError, setShapeError] = useState("");
  const editingShape = mode === "AIRSPACE" && shapeTool !== "POLYGON";
  const controls = editingShape
    ? (shape
        ? airspaceShapeHandles(shape)
        : shapeAnchor
          ? [shapeAnchor]
          : []
      ).map((point, index) => ({
        point,
        label:
          shapeTool === "CIRCLE"
            ? index === 0
              ? "圆心"
              : "半径"
            : index === 0
              ? "西南"
              : "东北",
      }))
    : undefined;
  const [selected, setSelected] = useState<number | null>(
    points.length ? 0 : null,
  );
  const [interaction, setInteraction] = useState<"draw" | "inspect">("draw");
  const [building, setBuilding] = useState<MapBuilding | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [spaceAids, setSpaceAids] = useState({
    ground: true,
    curtain: true,
    labels: true,
  });
  const [focusRequest, setFocusRequest] = useState<{
    index: number;
    revision: number;
  }>();
  const [coordinateError, setCoordinateError] = useState("");
  const [heightError, setHeightError] = useState("");
  const [heightErrorIndex, setHeightErrorIndex] = useState<number>();
  const [allHeightDraft, setAllHeightDraft] = useState(
    String(relations.flightProfile?.defaultHeightMeters ?? 100),
  );
  const [pointHeightDraft, setPointHeightDraft] = useState("");
  const [terrainStatus, setTerrainStatus] = useState({
    known: 0,
    total: points.length,
  });
  const currentHeight =
    selected === null
      ? undefined
      : relations.flightProfile?.waypointHeightsMeters[selected];
  useEffect(() => {
    setPointHeightDraft(
      currentHeight === undefined ? "" : String(currentHeight),
    );
    setHeightError("");
  }, [selected, currentHeight]);
  useEffect(() => {
    // Initialize only the local form draft; the normal resource Save persists it.
    if (mode === "ROUTE") onContextChange?.(relations);
  }, []);
  const mapPoints = useMemo(
    () => points.map((p): [number, number] => [p[0], p[1]]),
    [points],
  );
  const length = routeLengthMeters(
    mode === "AIRSPACE" && points.length > 2 ? [...points, points[0]] : points,
  );
  const associated = relations.buildings.find(
    (item) => item.waypointIndex === selected,
  );
  const point = selected === null ? undefined : points[selected];
  const name = mode === "ROUTE" ? "航线" : "空域";
  const pointName = mode === "AIRSPACE" ? "边界点" : "航点";
  const innerRings =
    mode === "AIRSPACE"
      ? geometryInnerRings(sourceGeometry.current)
      : undefined;
  function changeRelations(next: GeometryContext) {
    setRelations(next);
    onContextChange?.(next);
  }
  function update(next: GeometryPosition[], nextContext = relations) {
    setPoints(next);
    onChange(drawGeometry(next, mode, sourceGeometry.current));
    changeRelations(
      mode === "ROUTE"
        ? ensureRouteFlightProfile(nextContext, next.length)
        : sanitizeGeometryContext(nextContext, next.length),
    );
  }
  function remove(index: number) {
    update(removeGeometryPoint(points, index), {
      ...removeGeometryAssociation(relations, index),
      airspaceShape: undefined,
    });
    setSelected(points.length > 1 ? Math.min(index, points.length - 2) : null);
  }
  function move(index: number, location: [number, number]) {
    if (editingShape) {
      if (shape) {
        const next = moveAirspaceShape(shape, index, location);
        if (next) applyShape(next);
        else setShapeError("范围无效，请检查坐标及尺寸");
      } else if (shapeAnchor) {
        setShapeAnchor(location);
        update([location]);
      }
      return;
    }
    update(updateGeometryPoint(points, index, location), {
      ...relations,
      airspaceShape: undefined,
    });
    setSelected(index);
    setCoordinateError("");
  }
  function applyShape(next: AirspaceShape): boolean {
    const nextPoints = airspaceShapePoints(next, points);
    if (nextPoints.length < 3) {
      setShapeError("范围无效，请检查坐标及尺寸；暂不支持跨越日期变更线或极点");
      return false;
    }
    setShape(next);
    setShapeAnchor(undefined);
    setShapeError("");
    update(nextPoints, { ...relations, airspaceShape: next });
    return true;
  }
  function mapPoint(location: [number, number]) {
    if (interaction !== "draw") return;
    if (!editingShape) {
      update([...points, location], { ...relations, airspaceShape: undefined });
      setSelected(points.length);
      return;
    }
    if (!shapeAnchor) {
      setShape(undefined);
      setShapeAnchor(location);
      setShapeError("");
      update([location], {
        ...relations,
        buildings: [],
        airspaceShape: undefined,
      });
      setSelected(null);
      return;
    }
    const next =
      shapeTool === "CIRCLE"
        ? moveAirspaceShape(
            { type: "CIRCLE", center: shapeAnchor, radiusMeters: 1 },
            1,
            location,
          )
        : {
            type: "RECTANGLE" as const,
            west: Math.min(shapeAnchor[0], location[0]),
            east: Math.max(shapeAnchor[0], location[0]),
            south: Math.min(shapeAnchor[1], location[1]),
            north: Math.max(shapeAnchor[1], location[1]),
          };
    if (!next || !applyShape(next))
      setShapeError("请选择不同位置，形成有效范围");
  }
  function coordinate(axis: 0 | 1, raw: string) {
    if (selected === null || !point) return;
    const number = Number(raw);
    if (
      !raw.trim() ||
      !Number.isFinite(number) ||
      Math.abs(number) > (axis === 0 ? 180 : 90)
    ) {
      setCoordinateError(
        `请输入有效${axis === 0 ? "经度（-180～180）" : "纬度（-90～90）"}`,
      );
      return;
    }
    const next: [number, number] = [point[0], point[1]];
    next[axis] = number;
    move(selected, next);
  }
  function associate() {
    if (!building || selected === null) return;
    changeRelations({
      ...relations,
      buildings: [
        ...relations.buildings.filter(
          (item) => item.waypointIndex !== selected,
        ),
        { ...building, waypointIndex: selected },
      ],
    });
  }
  function applyHeight(raw: string, index?: number) {
    const height = raw.trim() ? Number(raw) : NaN;
    if (!isRouteHeightMeters(height) || !relations.flightProfile) {
      setHeightErrorIndex(index);
      setHeightError(`高度须为 0～${MAX_ROUTE_HEIGHT_METERS} 米`);
      return;
    }
    changeRelations({
      ...relations,
      flightProfile:
        index === undefined
          ? setRouteFlightHeight(relations.flightProfile, height)
          : setRouteWaypointHeight(relations.flightProfile, index, height),
    });
    setHeightError("");
  }
  const editor = (
    <div className={`geometry-workspace ${expanded ? "expanded" : ""}`}>
      <div className="geometry-toolbar">
        {mode === "AIRSPACE" && (
          <div className="geometry-modes" aria-label="空域绘制形状">
            {(
              [
                ["POLYGON", "多边形"],
                ["CIRCLE", "圆形"],
                ["RECTANGLE", "矩形"],
              ] as const
            ).map(([tool, label]) => (
              <button
                key={tool}
                type="button"
                aria-pressed={shapeTool === tool}
                className={shapeTool === tool ? "active" : ""}
                onClick={() => {
                  setShapeTool(tool);
                  setShapeAnchor(undefined);
                  setShapeError("");
                  setSelected(null);
                  setInteraction("draw");
                  const detected = inferAirspaceShape(points);
                  setShape(detected?.type === tool ? detected : undefined);
                  if (tool === "POLYGON")
                    changeRelations(
                      sanitizeGeometryContext(
                        { ...relations, airspaceShape: undefined },
                        points.length,
                      ),
                    );
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="geometry-modes" aria-label="地图交互方式">
          <button
            type="button"
            className={interaction === "draw" ? "active" : ""}
            aria-pressed={interaction === "draw"}
            onClick={() => {
              setInteraction("draw");
              if (editingShape) {
                setShape(undefined);
                setShapeAnchor(undefined);
                setShapeError("");
                setSelected(null);
                update([], {
                  ...relations,
                  buildings: [],
                  airspaceShape: undefined,
                });
              }
            }}
          >
            <Plus size={14} />{" "}
            {editingShape
              ? "重新绘制"
              : `添加${mode === "ROUTE" ? "航点" : "边界点"}`}
          </button>
          {!editingShape && (
            <button
              type="button"
              className={interaction === "inspect" ? "active" : ""}
              aria-pressed={interaction === "inspect"}
              onClick={() => setInteraction("inspect")}
            >
              <Building2 size={14} /> 查看楼宇
            </button>
          )}
        </div>
        <div className="geometry-toolbar-stats">
          <strong>{points.length}</strong> 个点 <i />{" "}
          {mode === "ROUTE" ? "水平长度" : "边界周长"}{" "}
          <strong>
            {length >= 1000
              ? `${(length / 1000).toFixed(2)} km`
              : `${Math.round(length)} m`}
          </strong>
        </div>
        {!expanded && (
          <button
            type="button"
            className="geometry-expand"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={14} /> 全屏编辑
          </button>
        )}
      </div>
      <div className="geometry-editor-body">
        <div className="geometry-stage">
          <FlightMap
            compact
            initialThreeD={mode === "AIRSPACE" ? false : undefined}
            drawing={{
              mode,
              points: mapPoints,
              controls,
              innerRings,
              selectedIndex: selected,
              heightMeters:
                mode === "ROUTE"
                  ? relations.flightProfile?.waypointHeightsMeters
                  : undefined,
              showGroundProjection: spaceAids.ground,
              showCurtain: spaceAids.curtain,
              showHeightLabels: spaceAids.labels,
              onTerrainStatus: setTerrainStatus,
              focusRequest,
              interaction,
              onSelect: setSelected,
              onMove: move,
            }}
            onMapPoint={mapPoint}
            onBuildingSelect={setBuilding}
            selectedBuildingId={building?.id || associated?.id}
            selectedBuilding={building || associated}
          />
          {(mode === "AIRSPACE" ||
            interaction === "inspect" ||
            points.length < 2) && (
            <div className="geometry-map-instruction">
              <MousePointer2 size={13} />{" "}
              {interaction === "draw"
                ? editingShape
                  ? shapeTool === "CIRCLE"
                    ? "单击圆心，再单击边界确定半径；拖动圆心或半径点调整"
                    : "依次单击两个对角点绘制矩形，拖动对角点调整"
                  : `单击添加位置，拖动编号${pointName}调整`
                : `点击楼宇轮廓，查看资料并关联${pointName}`}
            </div>
          )}
          <div className="geometry-legend">
            {mode === "ROUTE" ? (
              <>
                <span className="line" />
                空中航线
                <span className="ground-line" />
                地面投影
                <span className="height-line" />
                离地高度
              </>
            ) : (
              <>
                <span className="boundary" /> 边界点 <span className="line" />
                空域边界
              </>
            )}
          </div>
        </div>
        <aside className="geometry-sidebar">
          {mode === "AIRSPACE" && onAirspaceProfileChange && (
            <AirspaceProfileInput
              value={airspaceProfile}
              onChange={onAirspaceProfileChange}
            />
          )}
          {mode === "AIRSPACE" && (
            <p className="airspace-height-summary">
              高度范围：{airspaceHeightLabel(airspaceProfile)}
              {!!innerRings?.length && ` · ${innerRings.length} 个内环已保留`}
            </p>
          )}
          {editingShape && shape && (
            <AirspaceShapeFields
              shape={shape}
              onChange={applyShape}
            />
          )}
          {editingShape && !shape && (
            <p className="airspace-height-summary">
              {shapeAnchor
                ? "请单击第二个位置完成绘制"
                : "在地图上单击两次绘制范围，完成后替换当前外环。"}
            </p>
          )}
          {shapeError && (
            <p className="geometry-coordinate-error" role="alert">
              {shapeError}
            </p>
          )}
          {!editingShape && (
            <>
              <div className="geometry-sidebar-title">
                <Route size={14} />
                <strong>{mode === "ROUTE" ? "航点列表" : "边界点列表"}</strong>
                <span>{points.length} 个</span>
              </div>
              {mode === "ROUTE" && (
                <section className="geometry-height-plan">
                  <div>
                    <strong>飞行高度</strong>
                    <span>相对地面 · 米</span>
                  </div>
                  <label htmlFor="route-all-height">统一规划高度</label>
                  <div className="geometry-height-batch">
                    <input
                      id="route-all-height"
                      aria-label="统一规划高度"
                      type="number"
                      min={0}
                      max={MAX_ROUTE_HEIGHT_METERS}
                      step="any"
                      value={allHeightDraft}
                      onChange={(event) =>
                        setAllHeightDraft(event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          applyHeight(allHeightDraft);
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => applyHeight(allHeightDraft)}
                    >
                      应用全部
                    </button>
                  </div>
                  <small>
                    新航点默认 {relations.flightProfile?.defaultHeightMeters}{" "}
                    m，可逐点调整
                  </small>
                  <small className="geometry-view-hint">
                    立体近览看高度，全线总览看范围。
                  </small>
                  {terrainStatus.total > 0 &&
                    terrainStatus.known < terrainStatus.total && (
                      <small className="geometry-terrain-note">
                        部分地形未就绪，按零高程基面预览
                      </small>
                    )}
                  {heightError && heightErrorIndex === undefined && (
                    <p className="geometry-coordinate-error" role="alert">
                      {heightError}
                    </p>
                  )}
                </section>
              )}
              {mode === "ROUTE" && (
                <details className="geometry-space-aids">
                  <summary>
                    空间辅助
                    <span>
                      {Object.values(spaceAids).filter(Boolean).length} 项已启用
                    </span>
                  </summary>
                  <div role="group" aria-label="空间辅助">
                    {(
                      [
                        { key: "ground", label: "地面投影" },
                        { key: "curtain", label: "高度幕帘" },
                        { key: "labels", label: "高度标注" },
                      ] as const
                    ).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        aria-pressed={spaceAids[item.key]}
                        onClick={() =>
                          setSpaceAids((previous) => ({
                            ...previous,
                            [item.key]: !previous[item.key],
                          }))
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <ol className="geometry-waypoints">
                {points.map((position, index) => {
                  const relation = relations.buildings.find(
                    (item) => item.waypointIndex === index,
                  );
                  return (
                    <li key={index}>
                      <button
                        type="button"
                        className={selected === index ? "selected" : ""}
                        onClick={() => {
                          setSelected(index);
                          setFocusRequest((previous) => ({
                            index,
                            revision: (previous?.revision || 0) + 1,
                          }));
                          setCoordinateError("");
                        }}
                        aria-label={`选择${pointName} ${index + 1}`}
                        aria-pressed={selected === index}
                      >
                        <b
                          className={
                            mode === "AIRSPACE"
                              ? "boundary"
                              : index === 0
                                ? "start"
                                : index === points.length - 1
                                  ? "end"
                                  : ""
                          }
                        >
                          {index + 1}
                        </b>
                        <div>
                          <strong>
                            {mode === "AIRSPACE"
                              ? `边界点 ${index + 1}`
                              : index === 0
                                ? "起点"
                                : index === points.length - 1
                                  ? "终点"
                                  : `航点 ${index + 1}`}
                            {position.length > 2 && <em>含来源高程</em>}
                          </strong>
                          <small>
                            {position[0].toFixed(6)}, {position[1].toFixed(6)}
                          </small>
                          {mode === "ROUTE" && (
                            <span className="geometry-waypoint-height">
                              ↑{" "}
                              {
                                relations.flightProfile?.waypointHeightsMeters[
                                  index
                                ]
                              }{" "}
                              m
                            </span>
                          )}
                          {relation && (
                            <span className="geometry-related-name">
                              <Building2 size={11} />
                              {relation.name}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
                {!points.length && (
                  <li className="geometry-no-points">
                    <MousePointer2 size={24} />
                    <strong>在地图上开始绘制</strong>
                    <span>
                      {mode === "ROUTE"
                        ? "至少添加 2 个航点"
                        : "至少添加 3 个边界点"}
                    </span>
                  </li>
                )}
              </ol>
              {point && selected !== null && (
                <section className="geometry-point-detail">
                  <div className="geometry-section-title">
                    <strong>
                      {pointName} {selected + 1}
                    </strong>
                    <button
                      type="button"
                      aria-label={`删除${pointName} ${selected + 1}`}
                      onClick={() => remove(selected)}
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                  {mode === "ROUTE" && (
                    <div className="geometry-point-height">
                      <label htmlFor="route-point-height">
                        航点规划高度（相对地面 / m）
                      </label>
                      <input
                        id="route-point-height"
                        aria-label="航点规划高度"
                        type="number"
                        required
                        min={0}
                        max={MAX_ROUTE_HEIGHT_METERS}
                        step="any"
                        value={pointHeightDraft}
                        onChange={(event) => {
                          const raw = event.currentTarget.value;
                          setPointHeightDraft(raw);
                          if (selected !== null) applyHeight(raw, selected);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      {point.length > 2 && (
                        <small>
                          来源高度：{point[2]}（高度基准未说明，保留原值）
                        </small>
                      )}
                    </div>
                  )}
                  {heightError && heightErrorIndex !== undefined && (
                    <p className="geometry-coordinate-error" role="alert">
                      {heightError}
                    </p>
                  )}
                  <div
                    className="geometry-coordinates"
                    key={`${selected}-${point[0]}-${point[1]}`}
                  >
                    <label>
                      经度
                      <input
                        aria-label={`${pointName}经度`}
                        type="number"
                        step="any"
                        required
                        min={-180}
                        max={180}
                        defaultValue={point[0]}
                        onBlur={(event) =>
                          coordinate(0, event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <label>
                      纬度
                      <input
                        aria-label={`${pointName}纬度`}
                        type="number"
                        step="any"
                        required
                        min={-90}
                        max={90}
                        defaultValue={point[1]}
                        onBlur={(event) =>
                          coordinate(1, event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                  </div>
                  {coordinateError && (
                    <p className="geometry-coordinate-error" role="alert">
                      {coordinateError}
                    </p>
                  )}
                  {associated && (
                    <div className="geometry-associated">
                      <Building2 size={13} />
                      <span>已关联：{associated.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          changeRelations({
                            ...relations,
                            buildings: relations.buildings.filter(
                              (item) => item.waypointIndex !== selected,
                            ),
                          })
                        }
                      >
                        解除
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          {!editingShape && (
            <section className="geometry-building-detail">
              <div className="geometry-section-title">
                <Building2 size={14} />
                <strong>楼宇参照</strong>
              </div>
              {building ? (
                <>
                  <h4>{building.name}</h4>
                  <dl>
                    <div>
                      <dt>来源高度</dt>
                      <dd>
                        {building.heightMeters === null
                          ? "来源未提供"
                          : `${building.heightMeters} m`}
                      </dd>
                    </div>
                    <div>
                      <dt>楼宇中心</dt>
                      <dd>
                        {building.center
                          .map((number) => number.toFixed(5))
                          .join(", ")}
                      </dd>
                    </div>
                    <div>
                      <dt>数据来源</dt>
                      <dd>{building.source}</dd>
                    </div>
                    {point && (
                      <div>
                        <dt>距当前{pointName}</dt>
                        <dd>
                          {(() => {
                            const distance = routeLengthMeters([
                              point,
                              building.center,
                            ]);
                            return distance >= 1000
                              ? `${(distance / 1000).toFixed(2)} km`
                              : `${Math.round(distance)} m`;
                          })()}
                        </dd>
                      </div>
                    )}
                  </dl>
                  <button
                    type="button"
                    className="geometry-associate-button"
                    disabled={selected === null || !onContextChange}
                    onClick={associate}
                  >
                    <Plus size={13} />
                    {selected === null
                      ? `请先选择${pointName}`
                      : `关联到${pointName} ${selected + 1}`}
                  </button>
                </>
              ) : (
                <p>
                  切换“查看楼宇”，放大地图后点击楼宇轮廓，关联到当前{pointName}
                  。
                </p>
              )}
              <small>
                楼宇覆盖以来源为准；渲染高度仅作参照，关联不代表已完成净空校验。
              </small>
            </section>
          )}
        </aside>
      </div>
      <div className="geometry-editor-footer">
        <button
          type="button"
          onClick={() => remove(points.length - 1)}
          disabled={!points.length || editingShape}
        >
          <Undo2 size={13} /> 撤销一点
        </button>
        <button
          type="button"
          onClick={() => {
            sourceGeometry.current = null;
            setShape(undefined);
            setShapeAnchor(undefined);
            setShapeError("");
            update([], {
              ...relations,
              buildings: [],
              airspaceShape: undefined,
            });
            setSelected(null);
          }}
          disabled={!points.length}
        >
          <RotateCcw size={13} /> 清空
        </button>
        <small>
          {drawGeometry(points, mode, value)
            ? "绘制已就绪，保存资源后生效"
            : editingShape
              ? "请在地图上单击两个位置完成绘制"
              : `继续添加位置，${mode === "ROUTE" ? "至少 2 个点" : "至少 3 个点"}`}
        </small>
        {expanded && (
          <button
            type="button"
            className="geometry-finish"
            onClick={() => setExpanded(false)}
          >
            <Check size={14} /> 完成绘制
          </button>
        )}
      </div>
    </div>
  );
  return (
    <div className="geometry-input">
      {expanded ? (
        <>
          <div className="geometry-editor-placeholder">
            <Route size={22} />
            <span>正在全屏编辑{name}</span>
            <button type="button" onClick={() => setExpanded(false)}>
              返回资源表单
            </button>
          </div>
          <Modal
            className="geometry-fullscreen-modal"
            title={`${name}编辑器`}
            onClose={() => setExpanded(false)}
          >
            {editor}
          </Modal>
        </>
      ) : (
        editor
      )}
    </div>
  );
}
