import { useMemo, useState } from "react";
import type { Entity } from "../api";
import { mapObjectGeometry } from "./mapObjectFocus";
import FlightMap from "./FlightMap";
import { Button } from "./UI";
import "./SourceRoutePreview.css";

const POINTS_PER_PAGE = 20;
type SourcePosition = [number, number, ...number[]];
type RouteGeometry = { type: "LineString"; coordinates: SourcePosition[] };

function readRoute(record: Entity): {
  geometry: RouteGeometry | null;
  reason: string;
} {
  const raw = record.geometry ?? record.sourceGeometry;
  if (raw == null || raw === "")
    return {
      geometry: null,
      reason: "来源未返回可预览的航点几何，暂不能显示航线范围。",
    };
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    const object =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    const candidate = object?.type === "Feature" ? object.geometry : object;
    const geometry =
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>)
        : null;
    if (
      !geometry ||
      geometry.type !== "LineString" ||
      !Array.isArray(geometry.coordinates)
    )
      return {
        geometry: null,
        reason: "来源几何不是有效的 LineString 航线，暂不能显示航点预览。",
      };
    if (geometry.coordinates.length < 2)
      return { geometry: null, reason: "来源航点不足 2 个，暂不能构成航线。" };
    const valid = geometry.coordinates.every(
      (point: unknown) =>
        Array.isArray(point) &&
        point.length >= 2 &&
        point.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        ),
    );
    if (!valid)
      return {
        geometry: null,
        reason: "来源航点包含无效坐标，暂不能完整预览；未拼接或补造航点。",
      };
    return {
      geometry: {
        type: "LineString",
        coordinates: geometry.coordinates as SourcePosition[],
      },
      reason: "",
    };
  } catch {
    return {
      geometry: null,
      reason: "来源几何格式无法解析，暂不能显示航点预览。",
    };
  }
}

function pointSequence(points: SourcePosition[]): [number, number][] {
  let coordinateScale = 1;
  for (const [x, y] of points)
    coordinateScale = Math.max(coordinateScale, Math.abs(x), Math.abs(y));
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const [x, y] of points) {
    west = Math.min(west, x / coordinateScale);
    east = Math.max(east, x / coordinateScale);
    south = Math.min(south, y / coordinateScale);
    north = Math.max(north, y / coordinateScale);
  }
  const width = east - west,
    height = north - south;
  const scale = 220 / Math.max(height, width / 2.9, Number.EPSILON);
  return points.map(([x, y]) => [
    360 + (x / coordinateScale - west - width / 2) * scale,
    140 - (y / coordinateScale - south - height / 2) * scale,
  ]);
}

function sequenceLabels(points: [number, number][], indices: number[]) {
  const labels = new Map<number, { x: number; y: number; halfWidth: number }>();
  if (!points.length) return labels;
  const overlaps = (candidate: { x: number; y: number; halfWidth: number }) =>
    [...labels.values()].some(
      (label) =>
        Math.abs(label.x - candidate.x) <
          label.halfWidth + candidate.halfWidth + 12 &&
        Math.abs(label.y - candidate.y) < 22,
    );
  const endpoints = [...new Set([0, points.length - 1])];
  // Reserve labels for the first/last source point before selecting page labels.
  for (const index of [
    ...endpoints,
    ...indices.filter((index) => !endpoints.includes(index)),
  ]) {
    const [x, y] = points[index];
    const label = {
      x,
      y: y - 12,
      halfWidth: (String(index + 1).length * 7 + 16) / 2,
    };
    if (overlaps(label)) {
      if (!endpoints.includes(index)) continue;
      label.y = y + 20;
    }
    labels.set(index, label);
  }
  return labels;
}

/** Read-only source geometry. An unspecified source datum never becomes WGS84 or AGL. */
export default function SourceRoutePreview({
  record,
  onOpenLocalArchive,
}: {
  record: Entity;
  onOpenLocalArchive?: (record: Entity) => void;
}) {
  const { geometry, reason } = useMemo(() => readRoute(record), [record]);
  const [page, setPage] = useState(1);
  const [rawOpen, setRawOpen] = useState(false);
  const coordinates = geometry?.coordinates || [];
  const normalized = useMemo(() => pointSequence(coordinates), [coordinates]);
  const confirmedWgs84 = record.coordinateReference === "WGS84";
  const mapRecord = useMemo<Entity>(
    () => ({
      id: record.id,
      title: String(record.title || record.name || "来源航线"),
      kind: "ROUTE",
      geometry,
    }),
    [record, geometry],
  );
  const canLocate = confirmedWgs84 && !!mapObjectGeometry(mapRecord);
  const pageCount = Math.max(
    1,
    Math.ceil(coordinates.length / POINTS_PER_PAGE),
  );
  const currentPage = Math.min(page, pageCount);
  const first = (currentPage - 1) * POINTS_PER_PAGE;
  const visible = coordinates.slice(first, first + POINTS_PER_PAGE);
  const diagramIndices = [
    ...new Set([
      0,
      ...visible.map((_, index) => first + index),
      coordinates.length - 1,
    ]),
  ].filter((index) => index >= 0);
  const labels = sequenceLabels(normalized, diagramIndices);
  const rawFields = ["geometry", "sourceGeometry", "parameters"].filter(
    (key) => record[key] != null,
  );
  return (
    <section className="source-route-preview" aria-label="来源航线预览">
      <div className="source-route-preview-heading">
        <h3>航线与航点</h3>
        <span>
          {geometry ? `${coordinates.length} 个来源航点` : "航点暂不可用"}
        </span>
      </div>
      {reason ? (
        <p className="source-route-message" role="status">
          {reason}
        </p>
      ) : (
        <>
          <p className="source-route-message">
            {canLocate
              ? "按来源明确声明的 WGS84 经纬度显示平面范围。来源 Z 单独保留，不作为离地规划高度。"
              : confirmedWgs84
                ? "来源声明 WGS84，但经纬度超出有效范围，暂不叠加地图；下方仅显示来源点序与原始坐标。"
                : "来源坐标基准未确认为 WGS84，暂不能叠加地理底图。下方仅显示来源点序与相对形状，不用于地图定位、测距或飞行规划。"}
          </p>
          {canLocate ? (
            <div className="source-route-map">
              <FlightMap
                compact
                initialThreeD={false}
                objects={[mapRecord]}
                focusObject={mapRecord}
                selectedObjectId={mapRecord.id}
              />
            </div>
          ) : (
            <div className="source-route-diagram">
              <svg
                role="img"
                aria-label="来源航线点序示意，无地理底图"
                viewBox="0 0 720 280"
              >
                <polyline
                  points={normalized
                    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
                    .join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                {diagramIndices.map((index) => {
                  const [x, y] = normalized[index];
                  const label = labels.get(index);
                  return (
                    <g key={index}>
                      <title>来源航点 {index + 1}</title>
                      <circle cx={x} cy={y} r="5" />
                      {label && (
                        <text x={label.x} y={label.y} textAnchor="middle">
                          {index + 1}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              <small>来源点序示意 · 数字对应下方航点序号</small>
            </div>
          )}
          <div className="source-route-point-table">
            <table aria-label="来源航点原始坐标">
              <thead>
                <tr>
                  <th>航点</th>
                  <th>{canLocate ? "经度（WGS84）" : "来源 X"}</th>
                  <th>{canLocate ? "纬度（WGS84）" : "来源 Y"}</th>
                  <th>来源 Z（基准未说明）</th>
                  <th>额外维度</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((point, index) => (
                  <tr key={first + index}>
                    <th scope="row">航点 {first + index + 1}</th>
                    <td>{point[0]}</td>
                    <td>{point[1]}</td>
                    <td>{point.length > 2 ? String(point[2]) : "未提供"}</td>
                    <td>
                      {point.length > 3
                        ? JSON.stringify(point.slice(3))
                        : "未提供"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="source-route-pagination" aria-label="来源航点分页">
            <span>
              第 {currentPage} / {pageCount} 页 · 每页 {POINTS_PER_PAGE} 个航点
            </span>
            <Button
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              上一页航点
            </Button>
            <Button
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              下一页航点
            </Button>
          </nav>
        </>
      )}
      <p className="source-route-edit-guide">
        来源目录为只读预览。需要编辑航线时，关闭此弹窗，切换上方“本地业务档案”，打开对应档案并选择“编辑档案”；尚无本地档案可使用“登记资源”。
      </p>
      {onOpenLocalArchive && (
        <Button primary onClick={() => onOpenLocalArchive(record)}>
          查看本地航线档案
        </Button>
      )}
      <p className="source-route-height-note">
        来源
        Z、来源高度及返航高度分别保留原值；来源未说明高度基准时，不解释为本平台
        AGL 规划高度。
      </p>
      {!!rawFields.length && (
        <details
          className="source-route-raw"
          onToggle={(event) => setRawOpen(event.currentTarget.open)}
        >
          <summary>查看来源几何原始字段</summary>
          {rawOpen &&
            rawFields.map((key) => (
              <div key={key}>
                <strong>{key}</strong>
                <pre>
                  {typeof record[key] === "string"
                    ? String(record[key])
                    : JSON.stringify(record[key], null, 2)}
                </pre>
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
