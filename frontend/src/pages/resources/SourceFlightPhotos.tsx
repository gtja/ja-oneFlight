import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, ExternalLink, MapPin, Search } from "lucide-react";
import { api, entityName, useCatalog, write, type Entity, type Page } from "../../api";
import { dateTime } from "../../domain";
import type { Navigate } from "../../navigation";
import { useUser } from "../../context";
import { Button, Modal } from "../../components/UI";
import "./mediaAssets.css";

type SourcePhoto = Entity & {
  sourceMediaId: string;
  sourceDeviceId: string;
  sourceActionId?: string;
  sourceActionItemId?: string;
  photoType?: string;
  capturedFrom?: string;
  longitude?: number;
  latitude?: number;
  sourceHeight?: number;
  previewUrl: string;
  associationStatus: "LINKED" | "AUTO_MATCHED" | "NEEDS_ASSOCIATION";
  taskId?: string;
  entityTitle?: string;
  caseId?: string;
  taskCandidates: Array<{ id: string; title: string; startAt: string; endAt: string }>;
};

function localDate(daysAgo = 0) {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function dayBoundary(day: string, end: boolean) {
  const date = new Date(`${day}T${end ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function photoLabel(photo: SourcePhoto) {
  return String(photo.title || photo.sourceName || "牍术飞行照片");
}

export default function SourceFlightPhotos({ navigate }: { navigate?: Navigate }) {
  const user = useUser();
  const client = useQueryClient();
  const canMarkClue = ["ADMIN", "DISPATCH", "DEPARTMENT"].includes(user.role);
  const [deviceId, setDeviceId] = useState("");
  const [fromDate, setFromDate] = useState(localDate(7));
  const [toDate, setToDate] = useState(localDate());
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [taskChoices, setTaskChoices] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<SourcePhoto | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const devices = useCatalog("/resources", { kind: "DEVICE" });
  const sourceDevices = useMemo(() => (devices.data?.items || [])
    .filter((resource) => typeof resource.sourceDeviceId === "string" && resource.sourceDeviceId)
    .sort((a, b) => entityName(a).localeCompare(entityName(b), "zh-CN")), [devices.data]);

  useEffect(() => {
    if (!deviceId && sourceDevices.length) setDeviceId(String(sourceDevices[0].sourceDeviceId));
  }, [deviceId, sourceDevices]);

  const from = dayBoundary(fromDate, false);
  const to = dayBoundary(toDate, true);
  const validRange = fromDate <= toDate
    && Date.parse(`${toDate}T00:00:00`) - Date.parse(`${fromDate}T00:00:00`) <= 30 * 86_400_000;
  useEffect(() => setPage(1), [deviceId, fromDate, toDate]);
  const photoQuery = useQuery({
    queryKey: ["/source-data/flight-photos", deviceId, from, to, page],
    enabled: !!deviceId && !!from && !!to && validRange,
    queryFn: () => api<Page>(`/source-data/flight-photos?${new URLSearchParams({
      deviceId,
      from,
      to,
      page: String(page),
      pageSize: "100",
    })}`),
  });

  const rows = useMemo(() => ((photoQuery.data?.items || []) as SourcePhoto[])
    .filter((photo) => !keyword.trim() || photoLabel(photo).toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())
      || String(photo.entityTitle || "").toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
    .sort((a, b) => Date.parse(String(b.capturedFrom || "")) - Date.parse(String(a.capturedFrom || ""))),
  [keyword, photoQuery.data]);

  async function associate(photo: SourcePhoto) {
    const selectedTaskId = taskChoices[photo.id] || photo.taskId;
    if (!selectedTaskId) {
      setErrorMessage("请先选择要关联的任务");
      return;
    }
    setBusyId(photo.id);
    setErrorMessage("");
    try {
      await write("/source-data/flight-photos/associate", {
        deviceId: photo.sourceDeviceId,
        sourceMediaId: photo.sourceMediaId,
        taskId: selectedTaskId,
      });
      await client.invalidateQueries({ queryKey: ["/source-data/flight-photos"] });
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "照片关联任务失败");
    } finally {
      setBusyId("");
    }
  }

  async function markClue(photo: SourcePhoto) {
    const selectedTaskId = taskChoices[photo.id] || photo.taskId;
    if (!selectedTaskId) {
      setErrorMessage("请先选择照片所属任务，再标记疑似线索");
      return;
    }
    setBusyId(photo.id);
    setErrorMessage("");
    try {
      const created = await write<Entity>("/source-data/flight-photos/clues", {
        deviceId: photo.sourceDeviceId,
        sourceMediaId: photo.sourceMediaId,
        taskId: selectedTaskId,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["/source-data/flight-photos"] }),
        client.invalidateQueries({ queryKey: ["/source-data/flight-photos", deviceId, from, to] }),
      ]);
      setSelected({ ...photo, caseId: created.id });
      navigate?.("scenes", { caseId: created.id });
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "形成场景线索失败");
    } finally {
      setBusyId("");
    }
  }

  function openPhoto(photo: SourcePhoto) {
    setSelected(photo);
    setPreviewFailed(false);
    setErrorMessage("");
  }

  return (
    <section className="source-flight-photos" aria-label="牍术飞行照片">
      <div className="source-photo-toolbar">
        <label>来源设备
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={!sourceDevices.length}>
            <option value="">请选择设备</option>
            {sourceDevices.map((device) => <option key={String(device.id)} value={String(device.sourceDeviceId)}>{entityName(device)}</option>)}
          </select>
        </label>
        <label>拍摄时间
          <span className="media-date-range">
            <input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} aria-label="开始日期" />
            <i>—</i>
            <input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} aria-label="结束日期" />
          </span>
        </label>
        <label className="source-photo-search"><Search size={14} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索照片或关联任务" /></label>
      </div>

      {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      {!validRange && <p className="form-error" role="alert">查询时间最多31天，请缩短日期范围。</p>}
      {devices.error && <p className="form-error" role="alert">设备档案读取失败：{devices.error.message}</p>}
      {!sourceDevices.length && !devices.isLoading && (
        <div className="media-empty"><Camera size={24} /><strong>没有可查询的牍术设备</strong><span>请先登记来源设备并确认当前账号有设备访问权限。</span></div>
      )}
      {photoQuery.error && <p className="form-error" role="alert">照片读取失败：{photoQuery.error.message}</p>}
      {photoQuery.isLoading ? <p className="muted" role="status">正在读取牍术飞行照片…</p> : null}
      {!photoQuery.error && !photoQuery.isLoading && sourceDevices.length && rows.length === 0 && (
        <div className="media-empty"><Camera size={24} /><strong>当前设备和时间范围没有照片</strong><span>照片保存在牍术来源端；调整设备或拍摄日期后重试。</span></div>
      )}
      {rows.length > 0 && (
        <>
          <div className="source-photo-grid">
            {rows.map((photo) => {
              const selectedTaskId = taskChoices[photo.id] || photo.taskId || "";
              const linked = photo.associationStatus === "LINKED";
              return (
                <article className="source-photo-card" key={photo.id}>
                  <button type="button" className="source-photo-image" onClick={() => openPhoto(photo)} aria-label={`预览${photoLabel(photo)}`}>
                    <img src={photo.previewUrl} alt={photoLabel(photo)} loading="lazy" />
                    <span>牍术飞行照片</span>
                  </button>
                  <div className="source-photo-info">
                    <strong title={photoLabel(photo)}>{photoLabel(photo)}</strong>
                    <small>{dateTime(photo.capturedFrom, true)} · {photo.photoType || "图片"}</small>
                    {photo.entityTitle && <small>任务：{photo.entityTitle}</small>}
                    <small className={`source-photo-match ${photo.associationStatus.toLowerCase()}`}>
                      {linked ? "已关联任务" : photo.associationStatus === "AUTO_MATCHED" ? "按设备和计划时段匹配" : "待关联任务"}
                    </small>
                    <div className="source-photo-actions">
                      {linked || photo.associationStatus === "AUTO_MATCHED" ? (
                        <Button small onClick={() => photo.taskId && navigate?.("dispatch", { taskId: photo.taskId })} disabled={!photo.taskId}>
                          查看任务 <ExternalLink size={12} />
                        </Button>
                      ) : (
                        <select aria-label={`选择${photoLabel(photo)}的关联任务`} value={selectedTaskId} onChange={(event) => setTaskChoices((current) => ({ ...current, [photo.id]: event.target.value }))}>
                          <option value="">选择关联任务</option>
                          {photo.taskCandidates.map((task) => <option key={task.id} value={task.id}>{task.title} · {dateTime(task.startAt, true)}</option>)}
                        </select>
                      )}
                      {!linked && photo.associationStatus !== "AUTO_MATCHED" && <Button small disabled={!selectedTaskId || busyId === photo.id} onClick={() => void associate(photo)}>{busyId === photo.id ? "处理中…" : "关联任务"}</Button>}
                      {canMarkClue && <Button small primary disabled={!selectedTaskId || busyId === photo.id || !!photo.caseId} onClick={() => void markClue(photo)}>{photo.caseId ? "已标记线索" : "标记疑似线索"}</Button>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="source-photo-pagination">
            <span>当前页 {rows.length} 张 · 共 {photoQuery.data?.total ?? rows.length} 张，来源文件仍保存在牍术。</span>
            <Button small disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</Button>
            <Button small disabled={page * 100 >= (photoQuery.data?.total || 0)} onClick={() => setPage((current) => current + 1)}>下一页</Button>
          </div>
        </>
      )}

      {selected && (
        <Modal title={photoLabel(selected)} onClose={() => setSelected(null)} wide>
          <div className="source-photo-preview-modal">
            {previewFailed ? <div className="scene-evidence-file"><AlertTriangle size={24} /><strong>照片暂时无法预览</strong><span>请确认来源服务和媒体文件可达。</span></div> : <img src={selected.previewUrl} alt={photoLabel(selected)} onError={() => setPreviewFailed(true)} />}
            <dl>
              <div><dt>拍摄时间</dt><dd>{dateTime(selected.capturedFrom, true)}</dd></div>
              <div><dt>设备</dt><dd>{sourceDevices.find((device) => device.sourceDeviceId === selected.sourceDeviceId)?.title || selected.sourceDeviceId}</dd></div>
              <div><dt>图片类型</dt><dd>{selected.photoType || "未知"}</dd></div>
              <div><dt>位置</dt><dd>{typeof selected.longitude === "number" && typeof selected.latitude === "number" ? <><MapPin size={12} />{selected.longitude.toFixed(5)}, {selected.latitude.toFixed(5)}</> : "未记录"}</dd></div>
              <div><dt>匹配任务</dt><dd>{selected.entityTitle || "待关联"}</dd></div>
              {selected.taskId && <div><dt>任务</dt><dd><button type="button" className="source-photo-task-link" onClick={() => navigate?.("dispatch", { taskId: selected.taskId })}>{selected.entityTitle || "打开关联任务"} <ExternalLink size={12} /></button></dd></div>}
              {selected.caseId && <div><dt>场景线索</dt><dd>已进入待复核</dd></div>}
            </dl>
          </div>
        </Modal>
      )}
    </section>
  );
}
