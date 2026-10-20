import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  drawGeometry,
  ensureRouteFlightProfile,
  geometryPositions,
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

export default function GeometryInput({
  value,
  context,
  mode,
  onChange,
  onContextChange,
}: {
  value: unknown;
  context?: unknown;
  mode: "ROUTE" | "AIRSPACE";
  onChange: (value: unknown) => void;
  onContextChange?: (context: GeometryContext) => void;
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
    update(
      removeGeometryPoint(points, index),
      removeGeometryAssociation(relations, index),
    );
    setSelected(points.length > 1 ? Math.min(index, points.length - 2) : null);
  }
  function move(index: number, location: [number, number]) {
    update(updateGeometryPoint(points, index, location));
    setSelected(index);
    setCoordinateError("");
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
        <div className="geometry-modes" aria-label="地图交互方式">
          <button
            type="button"
            className={interaction === "draw" ? "active" : ""}
            aria-pressed={interaction === "draw"}
            onClick={() => setInteraction("draw")}
          >
            <Plus size={14} /> 添加{mode === "ROUTE" ? "航点" : "边界点"}
          </button>
          <button
            type="button"
            className={interaction === "inspect" ? "active" : ""}
            aria-pressed={interaction === "inspect"}
            onClick={() => setInteraction("inspect")}
          >
            <Building2 size={14} /> 查看楼宇
          </button>
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
            drawing={{
              mode,
              points: mapPoints,
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
            onMapPoint={(location) => {
              if (interaction === "draw") {
                update([...points, location]);
                setSelected(points.length);
              }
            }}
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
                ? "单击添加位置，拖动编号航点调整"
                : "点击楼宇轮廓，查看资料并关联航点"}
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
                <span className="start" /> 起点 <span className="end" /> 终点{" "}
                <span className="line" />
                空域边界
              </>
            )}
          </div>
        </div>
        <aside className="geometry-sidebar">
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
                    aria-label={`选择航点 ${index + 1}`}
                    aria-pressed={selected === index}
                  >
                    <b
                      className={
                        index === 0
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
                        {index === 0
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
                <strong>航点 {selected + 1}</strong>
                <button
                  type="button"
                  aria-label={`删除航点 ${selected + 1}`}
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
                    aria-label="航点经度"
                    type="number"
                    step="any"
                    required
                    min={-180}
                    max={180}
                    defaultValue={point[0]}
                    onBlur={(event) => coordinate(0, event.currentTarget.value)}
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
                    aria-label="航点纬度"
                    type="number"
                    step="any"
                    required
                    min={-90}
                    max={90}
                    defaultValue={point[1]}
                    onBlur={(event) => coordinate(1, event.currentTarget.value)}
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
                      <dt>距当前航点</dt>
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
                    ? "请先选择航点"
                    : `关联到航点 ${selected + 1}`}
                </button>
              </>
            ) : (
              <p>切换“查看楼宇”，放大地图后点击楼宇轮廓，关联到当前航点。</p>
            )}
            <small>
              楼宇覆盖以来源为准；渲染高度仅作参照，关联不代表已完成净空校验。
            </small>
          </section>
        </aside>
      </div>
      <div className="geometry-editor-footer">
        <button
          type="button"
          onClick={() => remove(points.length - 1)}
          disabled={!points.length}
        >
          <Undo2 size={13} /> 撤销一点
        </button>
        <button
          type="button"
          onClick={() => {
            sourceGeometry.current = null;
            update([], { ...relations, buildings: [] });
            setSelected(null);
          }}
          disabled={!points.length}
        >
          <RotateCcw size={13} /> 清空
        </button>
        <small>
          {drawGeometry(points, mode, value)
            ? "绘制已就绪，保存资源后生效"
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
