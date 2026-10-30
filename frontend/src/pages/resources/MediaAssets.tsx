import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  FileText,
  HelpCircle,
  Image,
  Search,
  Share2,
  Video,
} from "lucide-react";
import { entityName, useCatalog, useList, write, type Entity } from "../../api";
import { dateTime } from "../../domain";
import type { Navigate } from "../../navigation";
import { useUser } from "../../context";
import { Button, Modal, Status } from "../../components/UI";
import SourceFlightPhotos from "./SourceFlightPhotos";
import "./mediaAssets.css";

type MediaAsset = Entity & {
  fileName?: string;
  filename?: string;
  contentType?: string;
  entityType?: string;
  entityTitle?: string;
  entityStatus?: string;
  createdAt?: string;
  region?: string;
  qualityStatus?: string;
  qualityNote?: string;
  reviewedAt?: string;
  archivedAt?: string;
  shared?: boolean;
  shareExpiresAt?: string;
  caseId?: string;
};

type ShareRequest = Entity & {
  targetOrganizationName?: string;
  sourceOrganizationName?: string;
  purpose?: string;
  expiresAt?: string;
  decisionNote?: string;
  attachmentCount?: number;
  createdBy?: string;
  decisionAt?: string;
};

const qualityLabels: Record<string, string> = {
  PENDING_REVIEW: "待质检",
  PASSED: "通过",
  NEEDS_SUPPLEMENT: "待补传",
};

function assetName(asset: MediaAsset) {
  return String(asset.fileName || asset.filename || asset.title || "未命名成果");
}

function assetQuality(asset: MediaAsset) {
  return asset.archivedAt ? "PASSED" : asset.qualityStatus || "PENDING_REVIEW";
}

function assetKind(asset: MediaAsset) {
  if (asset.shared) return "共享成果";
  return asset.entityType === "TASK" ? "任务成果" : "线索证据";
}

function mediaType(asset: MediaAsset) {
  const type = String(asset.contentType || "").toLowerCase();
  if (type.startsWith("image/")) return "IMAGE";
  if (type.startsWith("video/")) return "VIDEO";
  if (type.includes("pdf") || type.includes("document") || type.includes("text/"))
    return "DOCUMENT";
  return "OTHER";
}

function dateValue(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

export default function MediaAssets({
  rows,
  loading,
  error,
  total,
  search,
  onSearchChange,
  onOpen,
  navigate,
}: {
  rows: MediaAsset[];
  loading: boolean;
  error?: Error | null;
  total: number;
  search: string;
  onSearchChange: (value: string) => void;
  onOpen: (asset: Entity) => void;
  navigate?: Navigate;
}) {
  const user = useUser();
  const canManage = ["ADMIN", "DISPATCH"].includes(user.role);
  const client = useQueryClient();
  const [tab, setTab] = useState("ALL");
  const [category, setCategory] = useState<"LOCAL" | "FLIGHT_PHOTO">("LOCAL");
  const [searchMode, setSearchMode] = useState<"TEXT" | "MULTIMODAL">(
    search ? "MULTIMODAL" : "TEXT",
  );
  const [sourceFilter, setSourceFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [qualityFilter, setQualityFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState("DESC");
  const [view, setView] = useState("GRID");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareTab, setShareTab] = useState<"REQUEST" | "RECORDS">("RECORDS");
  const [targetOrganizationId, setTargetOrganizationId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [rejectingId, setRejectingId] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareBusy, setShareBusy] = useState(false);

  const organizations = useCatalog("/organizations", {}, shareOpen && canManage);
  const shareRequests = useList("/attachments/share-requests", {}, shareOpen && canManage);

  const baseRows = useMemo(() => rows.filter((asset) => {
    if (tab === "PENDING_REVIEW") return !asset.archivedAt && assetQuality(asset) === "PENDING_REVIEW";
    if (tab === "NEEDS_SUPPLEMENT") return !asset.archivedAt && assetQuality(asset) === "NEEDS_SUPPLEMENT";
    if (tab === "ARCHIVED") return !!asset.archivedAt;
    return true;
  }), [rows, tab]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return baseRows.filter((asset) => {
      if (sourceFilter && assetKind(asset) !== sourceFilter) return false;
      if (typeFilter && mediaType(asset) !== typeFilter) return false;
      if (qualityFilter && assetQuality(asset) !== qualityFilter) return false;
      const day = dateValue(asset.createdAt);
      if (fromDate && (!day || day < fromDate)) return false;
      if (toDate && (!day || day > toDate)) return false;
      if (!query) return true;
      const fields = searchMode === "MULTIMODAL"
        ? [assetName(asset), asset.entityTitle, asset.region, assetKind(asset), asset.contentType]
        : [assetName(asset)];
      return fields.some((field) => String(field || "").toLocaleLowerCase().includes(query));
    }).sort((left, right) => {
      const leftTime = Date.parse(String(left.createdAt || "")) || 0;
      const rightTime = Date.parse(String(right.createdAt || "")) || 0;
      return sort === "ASC" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [baseRows, fromDate, qualityFilter, search, searchMode, sort, sourceFilter, toDate, typeFilter]);

  const counts = useMemo(() => ({
    ALL: rows.length,
    PENDING_REVIEW: rows.filter((asset) => !asset.archivedAt && assetQuality(asset) === "PENDING_REVIEW").length,
    NEEDS_SUPPLEMENT: rows.filter((asset) => !asset.archivedAt && assetQuality(asset) === "NEEDS_SUPPLEMENT").length,
    ARCHIVED: rows.filter((asset) => !!asset.archivedAt).length,
  }), [rows]);

  const selectableRows = filteredRows.filter((asset) => !asset.shared && !!asset.organizationId);
  const selectedAssets = rows.filter((asset) => selectedIds.includes(asset.id));
  const shareSelectionValid = selectedAssets.length > 0
    && selectedAssets.length === selectedIds.length
    && selectedAssets.every((asset) => !asset.shared && !!asset.organizationId)
    && selectedAssets.every((asset) =>
      asset.organizationId === selectedAssets[0].organizationId
      && asset.region === selectedAssets[0].region,
    );
  const shareSourceOrganizationId = selectedAssets[0]?.organizationId;
  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((asset) => selectedIds.includes(asset.id));

  const categoryTabs = (
    <div className="media-category-tabs" role="tablist" aria-label="数据成果分类">
      <button role="tab" aria-selected={category === "LOCAL"} className={category === "LOCAL" ? "active" : ""} onClick={() => setCategory("LOCAL")}>本地任务成果</button>
      <button role="tab" aria-selected={category === "FLIGHT_PHOTO"} className={category === "FLIGHT_PHOTO" ? "active" : ""} onClick={() => setCategory("FLIGHT_PHOTO")}>牍术飞行照片</button>
    </div>
  );

  if (category === "FLIGHT_PHOTO") {
    return (
      <section className="media-assets" aria-label="数据成果档案">
        {categoryTabs}
        <SourceFlightPhotos navigate={navigate} />
      </section>
    );
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]);
  }

  function toggleAll() {
    setSelectedIds((current) => allVisibleSelected
      ? current.filter((id) => !selectableRows.some((asset) => asset.id === id))
      : [...new Set([...current, ...selectableRows.map((asset) => asset.id)])]);
  }

  function resetFilters() {
    onSearchChange("");
    setSearchMode("TEXT");
    setSourceFilter("");
    setTypeFilter("");
    setQualityFilter("");
    setFromDate("");
    setToDate("");
    setSort("DESC");
    setTab("ALL");
  }

  function openSharing() {
    setShareError("");
    setShareTab(selectedIds.length ? "REQUEST" : "RECORDS");
    setShareOpen(true);
  }

  async function submitShareRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShareError("");
    setShareBusy(true);
    try {
      await write("/attachments/share-requests", {
        attachmentIds: selectedIds,
        targetOrganizationId,
        purpose,
        expiresAt: new Date(Date.now() + Number(durationDays) * 86_400_000).toISOString(),
      });
      await client.invalidateQueries({ queryKey: ["/attachments/share-requests"] });
      setPurpose("");
      setShareTab("RECORDS");
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : "共享申请提交失败");
    } finally {
      setShareBusy(false);
    }
  }

  async function decideRequest(request: ShareRequest, action: "APPROVE" | "REJECT") {
    setShareError("");
    setShareBusy(true);
    try {
      await write(`/attachments/share-requests/${encodeURIComponent(request.id)}/actions`, {
        action,
        note: action === "REJECT" ? decisionNote : undefined,
      });
      await Promise.all([
        client.invalidateQueries({ queryKey: ["/attachments/share-requests"] }),
        client.invalidateQueries({ queryKey: ["catalog", "/attachments"] }),
      ]);
      setRejectingId("");
      setDecisionNote("");
    } catch (cause) {
      setShareError(cause instanceof Error ? cause.message : "共享申请处理失败");
    } finally {
      setShareBusy(false);
    }
  }

  return (
    <section className="media-assets" aria-label="数据成果档案">
      {categoryTabs}
      <div className="media-assets-toolbar">
        <div className="media-status-tabs" role="tablist" aria-label="成果状态筛选">
          {[
            ["ALL", "全部成果"],
            ["PENDING_REVIEW", "待质量检查"],
            ["NEEDS_SUPPLEMENT", "待补传"],
            ["ARCHIVED", "已归档"],
          ].map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "active" : ""}
              onClick={() => setTab(value)}
            >
              {label}<b>{counts[value as keyof typeof counts]}</b>
            </button>
          ))}
        </div>
        <div className="media-actions">
          <select aria-label="成果视图" value={view} onChange={(event) => setView(event.target.value)}>
            <option value="GRID">媒体视图</option>
            <option value="LIST">列表视图</option>
          </select>
          {canManage && <Button onClick={openSharing}><Share2 size={13} />共享申请与审批</Button>}
        </div>
      </div>

      <div className="media-search-row">
        <div className="media-search-modes" role="group" aria-label="成果搜索方式">
          <button className={searchMode === "TEXT" ? "active" : ""} onClick={() => setSearchMode("TEXT")}>普通搜索</button>
          <button className={searchMode === "MULTIMODAL" ? "active" : ""} onClick={() => setSearchMode("MULTIMODAL")}>多模态搜索</button>
        </div>
        <label className="media-search-input">
          <Search size={14} />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchMode === "TEXT" ? "搜索成果名称" : "搜索成果、任务、位置或媒体类型"}
            aria-label="搜索成果"
          />
        </label>
        <span className="media-search-help" title="多模态搜索当前匹配文件名、关联任务、区域与媒体类型，不解析文件内容。">
          <HelpCircle size={14} />
        </span>
      </div>

      <div className="media-filter-row" aria-label="成果筛选">
        <label>采集来源
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="">全部来源</option>
            <option value="任务成果">任务成果</option>
            <option value="线索证据">线索证据</option>
            <option value="共享成果">共享成果</option>
          </select>
        </label>
        <label>成果类型
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">全部类型</option>
            <option value="IMAGE">图片</option>
            <option value="VIDEO">视频</option>
            <option value="DOCUMENT">报告</option>
            <option value="OTHER">其他文件</option>
          </select>
        </label>
        <label>成果质量
          <select value={qualityFilter} onChange={(event) => setQualityFilter(event.target.value)}>
            <option value="">全部质量</option>
            <option value="PENDING_REVIEW">待质检</option>
            <option value="PASSED">通过</option>
            <option value="NEEDS_SUPPLEMENT">待补传</option>
          </select>
        </label>
        <label>采集日期
          <span className="media-date-range">
            <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="开始日期" />
            <i>—</i>
            <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="结束日期" />
          </span>
        </label>
        <button className="media-reset" onClick={resetFilters}>重置筛选</button>
      </div>

      <div className="media-selection-row">
        <label>
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="全选当前成果" />
          全选&nbsp; {filteredRows.length} 份成果
        </label>
        <span>{selectedIds.length ? `已选 ${selectedIds.length} 份` : ""}</span>
        <label className="media-sort">采集时间
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="采集时间排序">
            <option value="DESC">倒序</option>
            <option value="ASC">正序</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="form-error" role="alert">成果档案读取失败：{error.message}</p>
      ) : loading ? (
        <p className="muted" role="status">正在读取成果档案…</p>
      ) : filteredRows.length ? (
        <div className={`media-asset-grid ${view === "LIST" ? "list-view" : ""}`}>
          {filteredRows.map((asset) => {
            const type = mediaType(asset);
            const archived = !!asset.archivedAt;
            const quality = assetQuality(asset);
            return (
              <article className="media-asset-card" key={asset.id}>
                <div className="media-asset-thumb">
                  {type === "IMAGE" ? (
                    <img src={`/api/v1/attachments/${encodeURIComponent(asset.id)}/preview`} alt="" loading="lazy" />
                  ) : (
                    <div className="media-file-placeholder">
                      {type === "VIDEO" ? <Video size={22} /> : type === "DOCUMENT" ? <FileText size={22} /> : <Image size={22} />}
                    </div>
                  )}
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(asset.id)}
                    onChange={() => toggleSelected(asset.id)}
                    aria-label={`选择${assetName(asset)}`}
                    disabled={asset.shared || !asset.organizationId}
                  />
                  {(archived || quality === "NEEDS_SUPPLEMENT") && (
                    <span className={`media-asset-flag ${archived ? "archived" : "supplement"}`}>
                      {archived ? "已归档" : "待补传"}
                    </span>
                  )}
                  <span className="media-asset-type">{type === "IMAGE" ? "图片" : type === "VIDEO" ? "视频" : type === "DOCUMENT" ? "报告" : "文件"}</span>
                </div>
                <button className="media-asset-body" onClick={() => onOpen(asset)}>
                  <strong title={assetName(asset)}>{assetName(asset)}</strong>
                  <span className="media-asset-meta">
                    <time>{dateTime(asset.createdAt, true)}</time>
                    <Status status={quality} label={qualityLabels[quality] || quality} />
                  </span>
                  <small title={String(asset.entityTitle || asset.region || "")}>{asset.entityTitle || asset.region || "未关联业务记录"}</small>
                  {asset.caseId && <small className="media-clue-link">场景线索 · 已进入待复核</small>}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="media-empty">
          <Archive size={24} />
          <strong>当前筛选下没有成果</strong>
          <span>清除部分筛选条件后查看其他成果档案。</span>
        </div>
      )}
      {total > rows.length && <p className="media-result-count">当前显示 {rows.length} / {total} 份成果</p>}

      {shareOpen && canManage && (
        <Modal title="共享申请与审批" onClose={() => setShareOpen(false)} wide>
          <div className="media-share-tabs" role="tablist">
            <button className={shareTab === "REQUEST" ? "active" : ""} onClick={() => setShareTab("REQUEST")}>发起申请</button>
            <button className={shareTab === "RECORDS" ? "active" : ""} onClick={() => setShareTab("RECORDS")}>申请与审批记录</button>
          </div>
          {shareTab === "REQUEST" ? (
            <form className="media-share-form" onSubmit={submitShareRequest}>
              <p className="muted">申请只包含本次勾选的成果。目标组织审批通过后，可在有效期内查看和下载这些文件。</p>
              <label>共享成果
                <span>{selectedIds.length ? `已选择 ${selectedIds.length} 份` : "请先在成果卡片中勾选文件"}</span>
              </label>
              {selectedIds.length > 0 && !shareSelectionValid && (
                <p className="form-error" role="alert">共享申请须选择同一组织、同一区域的本地成果；已获共享的成果不能再次申请。</p>
              )}
              <label>目标组织
                <select value={targetOrganizationId} onChange={(event) => setTargetOrganizationId(event.target.value)} required disabled={organizations.isLoading || !organizations.data?.items.length}>
                  <option value="">请选择组织</option>
                  {(organizations.data?.items || []).filter((organization) => organization.status === "ACTIVE" && organization.id !== shareSourceOrganizationId).map((organization) => (
                    <option value={organization.id} key={organization.id}>{entityName(organization)}</option>
                  ))}
                </select>
              </label>
              <label>共享用途
                <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} minLength={5} maxLength={2000} required placeholder="说明共享用途和使用范围" />
              </label>
              <label>访问期限
                <select value={durationDays} onChange={(event) => setDurationDays(event.target.value)}>
                  <option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option>
                </select>
              </label>
              {organizations.error && <p className="form-error" role="alert">组织目录读取失败：{organizations.error.message}</p>}
              {shareError && <p className="form-error" role="alert">{shareError}</p>}
              <div className="media-share-actions">
                <Button type="button" onClick={() => setShareTab("RECORDS")}>查看申请记录</Button>
                <Button primary type="submit" disabled={shareBusy || !shareSelectionValid || !targetOrganizationId || purpose.trim().length < 5}>
                  {shareBusy ? "提交中…" : "提交共享申请"}
                </Button>
              </div>
            </form>
          ) : (
            <div className="media-share-records">
              {shareRequests.error ? <p className="form-error" role="alert">共享申请读取失败：{shareRequests.error.message}</p> : null}
              {shareError && <p className="form-error" role="alert">{shareError}</p>}
              {shareRequests.isLoading ? <p className="muted" role="status">正在读取申请…</p> : null}
              {(shareRequests.data?.items as ShareRequest[] | undefined)?.length ? (
                (shareRequests.data?.items as ShareRequest[]).map((request) => (
                  <article className="media-share-record" key={request.id}>
                    <div>
                      <strong>{request.sourceOrganizationName} → {request.targetOrganizationName}</strong>
                      <span>{request.attachmentCount} 份成果 · 有效至 {dateTime(request.expiresAt)}</span>
                      <p>{request.purpose}</p>
                      {request.decisionNote && <small>审批意见：{request.decisionNote}</small>}
                    </div>
                    <div className="media-share-record-actions">
                      <Status status={request.status} label={request.status === "PENDING" ? "待审批" : request.status === "APPROVED" ? "已批准" : "已驳回"} />
                      {request.status === "PENDING" && request.createdBy !== user.id && (
                        rejectingId === request.id ? (
                          <div className="media-reject-form">
                            <input value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="填写驳回原因" aria-label="驳回原因" />
                            <Button small disabled={shareBusy || !decisionNote.trim()} onClick={() => void decideRequest(request, "REJECT")}>确认驳回</Button>
                            <Button small onClick={() => { setRejectingId(""); setDecisionNote(""); }}>取消</Button>
                          </div>
                        ) : (
                          <>
                            <Button small primary disabled={shareBusy} onClick={() => void decideRequest(request, "APPROVE")}><Check size={12} />批准</Button>
                            <Button small disabled={shareBusy} onClick={() => { setRejectingId(request.id); setDecisionNote(""); }}>驳回</Button>
                          </>
                        )
                      )}
                    </div>
                  </article>
                ))
              ) : !shareRequests.isLoading ? (
                <p className="muted media-share-empty">暂无共享申请记录。</p>
              ) : null}
              {selectedIds.length > 0 && <Button primary onClick={() => setShareTab("REQUEST")}>为所选 {selectedIds.length} 份成果发起申请</Button>}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
