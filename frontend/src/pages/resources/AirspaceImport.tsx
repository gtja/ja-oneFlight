import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, Upload } from "lucide-react";
import { api, ApiError, entityName, type Entity } from "../../api";
import type {
  AirspaceImportPreview,
  AirspaceImportResult,
  AirspaceProfile,
} from "../../api/types";
import { REGIONS, dateTime } from "../../domain";
import { airspaceHeightLabel, airspaceProfileError } from "../../geometry";
import { AirspaceProfileInput } from "../../components/GeometryInput";
import FlightMap from "../../components/FlightMap";
import SelectControl from "../../components/SelectControl";
import { Button, Modal } from "../../components/UI";
import "./AirspaceImport.css";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const example = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "example-airspace-001",
      properties: {
        name: "示例空域（请替换范围后导入）",
        model: "作业范围",
        description: "WGS84坐标示例",
        airspaceProfile: {
          reference: "AGL",
          lowerHeightMeters: 0,
          upperHeightMeters: 120,
        },
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [120.15, 30.27],
            [120.16, 30.27],
            [120.16, 30.28],
            [120.15, 30.28],
            [120.15, 30.27],
          ],
        ],
      },
    },
  ],
};

export default function AirspaceImport({
  organizations,
  organizationId: initialOrganizationId,
  organizationError,
  onClose,
  onImported,
}: {
  organizations: Entity[];
  organizationId: string;
  organizationError?: Error | null;
  onClose: () => void;
  onImported: (result: AirspaceImportResult) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [organizationId, setOrganizationId] = useState(initialOrganizationId);
  const [region, setRegion] = useState("");
  const [confirmedWgs84, setConfirmedWgs84] = useState(false);
  const [profile, setProfile] = useState<AirspaceProfile>();
  const [preview, setPreview] = useState<AirspaceImportPreview | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>();
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [expiredByServer, setExpiredByServer] = useState(false);
  useEffect(() => {
    if (!preview?.expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview?.expiresAt]);
  const expired =
    expiredByServer ||
    !!(preview?.expiresAt && now >= Date.parse(preview.expiresAt));
  const objects = useMemo<Entity[]>(
    () =>
      (preview?.rows || [])
        .filter((row) => row.geometry)
        .map((row) => ({
          id: `preview-${row.index}`,
          title: row.title,
          kind: "AIRSPACE",
          metadata: { geometry: row.geometry },
        })),
    [preview],
  );
  const selected = preview?.rows.find((row) => row.index === selectedIndex);
  const invalidate = () => {
    setPreview(null);
    setSelectedIndex(undefined);
    setExpiredByServer(false);
    setError("");
  };
  async function validate(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!file) {
      setError("请选择 GeoJSON 文件");
      return;
    }
    if (!/\.(geojson|json)$/i.test(file.name)) {
      setError("仅支持 .geojson 或 .json 文件");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("文件不能超过 2 MiB");
      return;
    }
    if (
      !organizationId ||
      !organizations.some((item) => item.id === organizationId)
    ) {
      setError("请选择有效的业务所属组织");
      return;
    }
    if (!region) {
      setError("请选择所属区域");
      return;
    }
    if (!confirmedWgs84) {
      setError("请确认文件坐标为 WGS84 经纬度");
      return;
    }
    const profileError = airspaceProfileError(profile);
    if (profileError) {
      setError(profileError);
      return;
    }
    setBusy("preview");
    setPreview(null);
    setExpiredByServer(false);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append(
        "options",
        new Blob(
          [
            JSON.stringify({
              organizationId,
              region,
              coordinateReference: "WGS84",
              ...(profile ? { defaultAirspaceProfile: profile } : {}),
            }),
          ],
          { type: "application/json" },
        ),
      );
      const report = await api<AirspaceImportPreview>(
        "/resources/airspace-imports/preview",
        { method: "POST", body },
      );
      setPreview(report);
      setSelectedIndex(report.rows.find((row) => row.geometry)?.index);
      setNow(Date.now());
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "文件校验失败，请重试",
      );
    } finally {
      setBusy(null);
    }
  }
  async function commit() {
    if (!preview?.canCommit || !preview.batchId || expired || busy) return;
    setError("");
    setBusy("commit");
    try {
      const result = await api<AirspaceImportResult>(
        `/resources/airspace-imports/${encodeURIComponent(preview.batchId)}/commit`,
        { method: "POST" },
      );
      await onImported(result);
      onClose();
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.code === "IMPORT_PREVIEW_EXPIRED"
      )
        setExpiredByServer(true);
      setError(
        failure instanceof Error ? failure.message : "导入未确认，请重试本批次",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <Modal
      title="批量导入空域"
      className="airspace-import-modal"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="airspace-import">
        <ol className="airspace-import-steps" aria-label="导入步骤">
          <li className={!preview ? "active" : ""}>1 选择文件与归属</li>
          <li className={preview ? "active" : ""}>2 校验与范围预览</li>
          <li>3 确认导入</li>
        </ol>
        <p className="notice">
          仅支持 WGS84 Polygon、Feature 或 FeatureCollection。最多 100
          个空域、每个 2,000 点、整批 20,000
          点（含内环及闭合点）。导入后为待确认档案。
        </p>
        <form onSubmit={validate}>
          <fieldset className="airspace-import-options" disabled={!!busy}>
            <label className="airspace-import-file">
              GeoJSON 文件
              <input
                type="file"
                aria-label="GeoJSON 文件"
                accept=".geojson,.json,application/geo+json,application/json"
                onChange={(event) => {
                  invalidate();
                  setFile(event.currentTarget.files?.[0] || null);
                }}
              />
              <small>
                最大 2 MiB。{file ? `已选择：${file.name}` : "请选择本地文件"}
              </small>
            </label>
            <a
              className="airspace-import-example"
              download="空域导入示例.geojson"
              href={`data:application/geo+json;charset=utf-8,${encodeURIComponent(JSON.stringify(example, null, 2))}`}
            >
              <Download size={14} />
              下载示例文件
            </a>
            <label htmlFor="airspace-import-organization">业务所属组织</label>
            <SelectControl
              id="airspace-import-organization"
              value={organizationId}
              disabled={!!busy || !!organizationError}
              options={[
                { value: "", label: "请选择" },
                ...organizations.map((item) => ({
                  value: item.id,
                  label: entityName(item),
                })),
              ]}
              onChange={(value) => {
                invalidate();
                setOrganizationId(value);
              }}
            />
            {organizationError && (
              <p className="form-error" role="alert">
                组织目录加载失败：{organizationError.message}
              </p>
            )}
            <label htmlFor="airspace-import-region">所属区域</label>
            <SelectControl
              id="airspace-import-region"
              value={region}
              disabled={!!busy}
              options={[
                { value: "", label: "请选择" },
                ...REGIONS.map((value) => ({ value, label: value })),
              ]}
              onChange={(value) => {
                invalidate();
                setRegion(value);
              }}
            />
            <label className="airspace-import-coordinate">
              <input
                type="checkbox"
                checked={confirmedWgs84}
                onChange={(event) => {
                  invalidate();
                  setConfirmedWgs84(event.currentTarget.checked);
                }}
              />
              确认文件使用 WGS84 经纬度，不执行坐标转换
            </label>
            <details>
              <summary>可选：统一高度（仅用于文件未提供高度的空域）</summary>
              <AirspaceProfileInput
                value={profile}
                disabled={!!busy}
                onChange={(value) => {
                  invalidate();
                  setProfile(value);
                }}
              />
            </details>
            <Button
              type="submit"
              primary
              disabled={!!busy || !!organizationError}
            >
              <Upload size={14} />
              {busy === "preview"
                ? "正在校验…"
                : preview
                  ? "重新校验预览"
                  : "校验并预览"}
            </Button>
          </fieldset>
        </form>
        {preview && (
          <section
            className="airspace-import-preview"
            aria-label="空域导入预览"
          >
            <p className="airspace-import-summary" role="status">
              共 {preview.summary.total} 条 · 有效 {preview.summary.valid} 条 ·
              错误 {preview.summary.invalid} 条 · 重复{" "}
              {preview.summary.duplicates} 条 · {preview.summary.pointCount}{" "}
              个点
            </p>
            <div className="airspace-import-review">
              <ol className="airspace-import-rows">
                {preview.rows.map((row) => (
                  <li
                    key={row.index}
                    className={selectedIndex === row.index ? "selected" : ""}
                  >
                    <button
                      type="button"
                      aria-pressed={selectedIndex === row.index}
                      onClick={() => setSelectedIndex(row.index)}
                    >
                      <strong>
                        {row.index}. {row.title}
                      </strong>
                      <span>
                        {row.errors.length
                          ? "需修正"
                          : row.duplicate
                            ? "重复，将跳过"
                            : "可导入"}
                      </span>
                    </button>
                    <small>
                      {row.pointCount} 个点 ·{" "}
                      {airspaceHeightLabel(row.airspaceProfile)}
                    </small>
                    {row.errors.map((issue, index) => (
                      <p className="form-error" key={`error-${index}`}>
                        {issue.message}
                      </p>
                    ))}
                    {row.warnings.map((issue, index) => (
                      <p
                        className="airspace-import-warning"
                        key={`warning-${index}`}
                      >
                        {issue.message}
                      </p>
                    ))}
                  </li>
                ))}
              </ol>
              <div className="airspace-import-map">
                <FlightMap
                  compact
                  initialThreeD={false}
                  objects={objects}
                  focusObject={objects.find(
                    (object) => object.id === `preview-${selectedIndex}`,
                  )}
                  selectedObjectId={`preview-${selectedIndex}`}
                  onSelect={(object) =>
                    setSelectedIndex(Number(object.id.replace("preview-", "")))
                  }
                />
                {selected && (
                  <p>
                    {selected.title} ·{" "}
                    {airspaceHeightLabel(selected.airspaceProfile)}
                    {selected.geometry &&
                      ` · ${Math.max(0, selected.geometry.coordinates.length - 1)} 个内环`}
                  </p>
                )}
              </div>
            </div>
            {!preview.canCommit && (
              <p className="form-error" role="alert">
                请修正文件中的错误后重新预览，整批校验通过后才能导入。
              </p>
            )}
            {expired ? (
              <p className="form-error" role="alert">
                预览已过期，请重新校验预览。
              </p>
            ) : (
              preview.expiresAt && (
                <p className="footnote">
                  预览有效至 {dateTime(preview.expiresAt)}
                  。文件或选项变化后需重新预览。
                </p>
              )
            )}
          </section>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
            {preview?.batchId && !expired
              ? "。可重试确认本批次，重复请求不会重复创建档案。"
              : ""}
          </p>
        )}
        <footer className="form-footer">
          <Button onClick={onClose} disabled={!!busy}>
            取消
          </Button>
          <Button
            primary
            onClick={commit}
            disabled={
              !!busy || !preview?.canCommit || !preview.batchId || expired
            }
          >
            {busy === "commit" ? "正在导入…" : "确认导入"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
