import { useState } from "react";
import { AlertTriangle, Download, FileText, Image, MapPin, Upload } from "lucide-react";
import { api, entityName, useList, type Entity } from "../../api";
import { dateTime } from "../../domain";
import type { Navigate } from "../../navigation";
import { Button, Empty, Status } from "../../components/UI";
import { useMutationFeedback } from "../../components/Workflow";

type CaseAttachment = Entity & {
  fileName?: string;
  filename?: string;
  contentType?: string;
  size?: number;
  createdAt?: string;
  qualityStatus?: string;
  qualityNote?: string;
  archivedAt?: string;
  longitude?: number;
  latitude?: number;
};

type CaseSourcePhoto = Entity & {
  previewUrl: string;
  photoType?: string;
  capturedFrom?: string;
  longitude?: number;
  latitude?: number;
  sourceDeviceId: string;
  taskId?: string;
  entityTitle?: string;
};

const qualityLabels: Record<string, string> = {
  PENDING_REVIEW: "待质检",
  PASSED: "已通过",
  NEEDS_SUPPLEMENT: "待补传",
};

function fileName(file: CaseAttachment) {
  return String(file.fileName || file.filename || file.title || "现场证据");
}

function coordinates(file?: CaseAttachment) {
  if (typeof file?.longitude !== "number" || typeof file.latitude !== "number")
    return "位置未记录";
  return `${file.longitude.toFixed(5)}, ${file.latitude.toFixed(5)}`;
}

export default function CaseEvidence({
  record,
  readOnly,
  navigate,
}: {
  record: Entity;
  readOnly: boolean;
  navigate: Navigate;
}) {
  const query = useList("/attachments", { caseId: record.id });
  const sourceQuery = useList("/source-data/flight-photos/cases", { caseId: record.id });
  const mutate = useMutationFeedback();
  const [selectedId, setSelectedId] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const files = (query.data?.items || []) as CaseAttachment[];
  const sourceFiles = (sourceQuery.data?.items || []) as CaseSourcePhoto[];
  const selectedSource = sourceFiles.find((file) => file.id === selectedSourceId);
  const selected = selectedSource || files.find((file) => file.id === selectedId) || files[0] || sourceFiles[0];
  const selectedIsSource = !!selectedSource || (!files.length && !!sourceFiles.length && selected === sourceFiles[0]);
  const selectedName = selected ? fileName(selected) : "现场影像复核";
  const type = String(selected?.contentType || "").toLowerCase();
  const image = type.startsWith("image/");

  async function upload(file?: File) {
    if (!file) return;
    setUploadBusy(true);
    setUploadError("");
    const body = new FormData();
    body.append("file", file);
    body.append("caseId", record.id);
    try {
      const saved = await mutate(
        () => api<Entity>("/attachments", { method: "POST", body }),
        "现场证据已上传并进入数据成果档案",
      ) as Entity;
      setSelectedId(saved.id);
      setSelectedSourceId("");
      setPreviewFailed(false);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "现场证据上传失败");
    } finally {
      setUploadBusy(false);
    }
  }

  function openArchive() {
    navigate("resources", {
      resourceKind: "MEDIA",
      resourceSearch: entityName(record),
    });
  }

  return (
    <section className="scene-evidence" aria-label="现场证据复核">
      <header className="scene-evidence-heading">
        <div>
          <small>{record.scene ? `${String(record.scene)}现场核查` : "现场核查"}</small>
          <h3>现场影像复核</h3>
        </div>
        <div className="scene-evidence-actions">
          <Button small onClick={openArchive}>查看成果档案</Button>
          {!readOnly && (
            <label className={`button small ${uploadBusy ? "disabled" : ""}`}>
              <Upload size={13} />
              {uploadBusy ? "正在上传" : "补充现场素材"}
              <input
                hidden
                type="file"
                accept="image/*,video/*,.pdf,.doc,.docx"
                disabled={uploadBusy}
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </header>

      {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
      {sourceQuery.error && <p className="form-error" role="alert">来源飞行照片读取失败：{sourceQuery.error.message}</p>}
      <div className="scene-evidence-viewer">
        <div className="scene-evidence-preview">
          {selected && image && !previewFailed ? (
            <img
              src={selectedIsSource ? String((selected as CaseSourcePhoto).previewUrl) : `/api/v1/attachments/${encodeURIComponent(selected.id)}/preview`}
              alt={selectedName}
              onError={() => setPreviewFailed(true)}
            />
          ) : selected ? (
            <div className="scene-evidence-file">
              {previewFailed ? <AlertTriangle size={24} /> : <FileText size={28} />}
              <strong>{selectedName}</strong>
              <span>{selectedIsSource ? "照片保存在牍术来源端，可在本平台代理预览。" : image ? "图片暂时无法预览，可下载原件核查。" : "该文件类型不支持内嵌预览，可下载原件核查。"}</span>
              {!selectedIsSource && <a href={`/api/v1/attachments/${encodeURIComponent(selected.id)}/download`}><Download size={13} />下载原件</a>}
            </div>
          ) : (
            <Empty
              loading={query.isLoading}
              error={query.error}
              title="暂无现场素材"
              description="上传的图片、视频和文档会同时归入资源管理的数据成果档案。"
            />
          )}
          {selected && image && !previewFailed && (
            <div className="scene-evidence-caption">
              <strong>{selectedName}</strong>
              <span>{dateTime(String(selectedIsSource ? (selected as CaseSourcePhoto).capturedFrom || "" : (selected as CaseAttachment).createdAt || ""), true)}</span>
            </div>
          )}
        </div>
        <aside className="scene-evidence-inspector">
          <h4>采集素材</h4>
          {selected ? (
            <>
              <div className="scene-evidence-file-icon">
                {image ? <Image size={17} /> : <FileText size={17} />}
                <span>{type.startsWith("video/") ? "视频" : image ? "图片" : "文件"}</span>
              </div>
              <dl>
                <div><dt>素材名称</dt><dd title={selectedName}>{selectedName}</dd></div>
                <div><dt>采集时间</dt><dd>{dateTime(String(selectedIsSource ? (selected as CaseSourcePhoto).capturedFrom || "" : (selected as CaseAttachment).createdAt || ""))}</dd></div>
                <div><dt>采集位置</dt><dd><MapPin size={12} />{coordinates(selected)}</dd></div>
                {selectedIsSource ? <div><dt>采集来源</dt><dd>牍术飞行照片 · 来源文件未复制</dd></div> : <div><dt>素材状态</dt><dd><Status status={selected.archivedAt ? "ARCHIVED" : String(selected.qualityStatus || "PENDING_REVIEW")} label={selected.archivedAt ? "已归档" : qualityLabels[String(selected.qualityStatus || "PENDING_REVIEW")] || "待质检"} /></dd></div>}
              </dl>
              {!selectedIsSource && selected.qualityNote && <p className="scene-evidence-note">质检意见：{String(selected.qualityNote)}</p>}
              {!selectedIsSource && <a className="scene-evidence-download" href={`/api/v1/attachments/${encodeURIComponent(selected.id)}/download`}><Download size={13} />下载原始素材</a>}
              {selectedIsSource && (selected as CaseSourcePhoto).taskId && <Button small onClick={() => navigate("dispatch", { taskId: (selected as CaseSourcePhoto).taskId })}>查看关联任务</Button>}
            </>
          ) : (
            <p className="muted">选择或上传素材后显示采集信息。</p>
          )}
        </aside>
      </div>

      <div className="scene-evidence-thumbnails" aria-label="现场素材列表">
        <span>采集素材 <b>{(query.data?.total ?? files.length) + (sourceQuery.data?.total ?? sourceFiles.length)}</b></span>
        {files.map((file) => {
          const thumbType = String(file.contentType || "").toLowerCase();
          const isImage = thumbType.startsWith("image/");
          return (
            <button
              type="button"
              key={file.id}
              className={file.id === selected?.id ? "active" : ""}
              onClick={() => {
                setSelectedId(file.id);
                setSelectedSourceId("");
                setPreviewFailed(false);
              }}
              title={fileName(file)}
            >
              {isImage ? (
                <img src={`/api/v1/attachments/${encodeURIComponent(file.id)}/preview`} alt="" />
              ) : <FileText size={20} />}
              <span><strong>{fileName(file)}</strong><small>{dateTime(file.createdAt, true)}</small></span>
              <Status status={file.archivedAt ? "ARCHIVED" : file.qualityStatus || "PENDING_REVIEW"} label={file.archivedAt ? "已归档" : qualityLabels[String(file.qualityStatus || "PENDING_REVIEW")] || "待质检"} />
            </button>
          );
        })}
        {sourceFiles.map((file) => (
          <button
            type="button"
            key={file.id}
            className={file.id === selected?.id && selectedIsSource ? "active" : ""}
            onClick={() => {
              setSelectedSourceId(file.id);
              setSelectedId("");
              setPreviewFailed(false);
            }}
            title={fileName(file)}
          >
            <img src={file.previewUrl} alt="" />
            <span><strong>{fileName(file)}</strong><small>{dateTime(file.capturedFrom, true)} · 牍术照片</small></span>
            <Status status="SOURCE" label={file.photoType || "来源照片"} />
          </button>
        ))}
        {!files.length && !sourceFiles.length && !query.isLoading && !sourceQuery.isLoading && <p className="muted">还没有本地证据或已标记的来源飞行照片。</p>}
      </div>
    </section>
  );
}
