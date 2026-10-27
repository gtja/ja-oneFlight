import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { api, useList, write, type Entity } from "../api";
import { dateTime } from "../domain";
import { Details, Empty, EntityForm, Modal, type Field } from "./UI";
import { useFeedback } from "../context";

const workflowLabels: Record<string, string> = {
  CREATE: "创建记录",
  INITIALIZE: "初始化登记",
  CREATE_FROM_PLAN: "从计划安排任务",
  SOURCE_IMPORT: "来源档案导入",
  FILE_IMPORT: "本地文件导入",
  UPDATE: "修改记录",
  SUBMIT: "提交申请",
  ASSIGN: "分配资源",
  LINK_PLAN: "关联飞行计划",
  START: "开始执行",
  FINISH: "提交成果",
  ACCEPT: "验收通过",
  RETURN: "退回完善",
  CANCEL: "取消事项",
  APPROVE: "审核通过",
  REGISTER_RECEIPT: "登记回执",
  VERIFY: "复核通过",
  TRANSFER: "移交现场核查",
  RESOLVE: "登记处置",
  ARCHIVE: "完成归档",
  DISMISS: "无效线索归档",
  REPLY: "登记答复",
  COMPLETE: "确认完成",
  FLIGHT_ENTRY_GRANTED: "飞控入口已放行",
  FLIGHT_ENTRY_CHECK_PASSED: "飞控入口校验通过",
  BOOTSTRAP_ACCEPTED: "飞控页面已接入",
  TICKET_ISSUED: "飞控访问凭证已签发",
};

function workflowLabel(value: unknown) {
  const text = String(value ?? "");
  return workflowLabels[text] || text;
}
export function useMutationFeedback() {
  const client = useQueryClient();
  const feedback = useFeedback();
  return async (action: () => Promise<unknown>, message = "已保存") => {
    const result = await action();
    await client.invalidateQueries();
    feedback(message);
    return result;
  };
}
export function ActionModal({
  path,
  action,
  title,
  fields = [],
  onClose,
  notice,
  closeOnSuccess = false,
}: {
  path: string;
  action: string;
  title: string;
  fields?: Field[];
  onClose: () => void;
  notice?: string;
  closeOnSuccess?: boolean;
}) {
  const mutate = useMutationFeedback();
  return (
    <Modal title={title} onClose={onClose}>
      <EntityForm
        fields={[
          ...fields,
          {
            key: "note",
            label: "办理说明",
            type: "textarea",
            required:
              ["RETURN", "CANCEL"].includes(action) ||
              (action === "DISMISS" &&
                !fields.some((field) => field.key === "conclusion")),
            wide: true,
          },
        ]}
        notice={notice}
        onCancel={onClose}
        submitLabel={title}
        onSubmit={async (body) => {
          await mutate(
            () => write(`${path}/actions`, { ...body, action }),
            `${title}已完成`,
          );
          if (closeOnSuccess) onClose();
        }}
      />
    </Modal>
  );
}
export function History({ path }: { path: string }) {
  const query = useList(`${path}/history`);
  return (
    <section className="section">
      <div className="section-title">
        <h3>办理履历</h3>
        <span>{query.data?.total ?? 0} 条记录</span>
      </div>
      {query.data?.items.length ? (
        <ol className="timeline">
          {query.data.items.map((r) => (
            <li key={r.id}>
              <time>{dateTime(r.createdAt, true)}</time>
              <div>
                <strong>
                  {workflowLabel(r.actionLabel || r.action || "办理记录")}
                </strong>
                <p>{workflowLabel(r.note || r.message || "")}</p>
                <small>{String(r.actorName || r.actor || "")}</small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Empty
          loading={query.isLoading}
          error={query.error}
          title="暂无办理记录"
          description="提交或办理事项后，操作记录会保存在这里。"
        />
      )}
    </section>
  );
}
export function Attachments({
  taskId,
  caseId,
  readOnly = false,
}: {
  taskId?: string;
  caseId?: string;
  readOnly?: boolean;
}) {
  const query = useList("/attachments", { taskId, caseId });
  const mutate = useMutationFeedback();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    const data = new FormData();
    data.append("file", file);
    if (taskId) data.append("taskId", taskId);
    if (caseId) data.append("caseId", caseId);
    try {
      await mutate(
        () => api("/attachments", { method: "POST", body: data }),
        "成果文件已上传",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <div className="section-title">
        <h3>成果与证据</h3>
        {!readOnly && (
          <label className={`button small ${busy ? "disabled" : ""}`}>
            <Upload size={13} />
            {busy ? "正在上传" : "上传文件"}
            <input
              hidden
              type="file"
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="attachment-list">
        {query.data?.items.map((file: Entity) => (
          <a
            className="attachment"
            key={file.id}
            href={`/api/v1/attachments/${file.id}/content`}
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={18} />
            <div>
              <strong>
                {String(file.fileName || file.title || "成果文件")}
              </strong>
              <small>
                {dateTime(file.createdAt)} ·{" "}
                {file.size
                  ? `${(Number(file.size) / 1024).toFixed(1)} KB`
                  : "已上传"}
              </small>
            </div>
          </a>
        ))}
      </div>
      {!query.data?.items.length && (
        <Empty
          loading={query.isLoading}
          error={query.error}
          title="暂无成果文件"
          description="支持上传本次任务的图片、文档及现场核查材料。"
        />
      )}
    </section>
  );
}

export function Provenance({ record }: { record: Entity }) {
  const data = record.provenance as Record<string, unknown> | undefined;
  if (!data || !Object.keys(data).length) return null;
  return (
    <section className="section">
      <h3>来源信息</h3>
      <Details
        items={[
          {
            label: "登记来源",
            value:
              data.origin === "FILE_IMPORTED"
                ? "本地文件导入"
                : data.origin === "BUSINESS_INITIALIZATION"
                  ? "平台初始化录入"
                  : data.sourceSystem || data.system
                    ? String(data.sourceSystem || data.system)
                    : data.origin === "MANUAL"
                      ? "人工登记"
                      : "来源档案导入",
          },
          {
            label: "来源说明",
            value: String(
              data.description || "真实来源档案，保留来源编号与原始状态",
            ),
          },
          {
            label: "登记时间",
            value: dateTime(data.recordedAt || data.importedAt),
          },
          ...(data.sourceId || data.id
            ? [{ label: "来源编号", value: String(data.sourceId || data.id) }]
            : []),
          ...(data.sourceEntity || data.entity
            ? [
                {
                  label: "来源目录",
                  value: String(data.sourceEntity || data.entity),
                },
              ]
            : []),
          ...(data.sourceStatus
            ? [{ label: "来源状态", value: String(data.sourceStatus) }]
            : []),
          ...(data.sourceCreatedAt
            ? [{ label: "来源创建时间", value: dateTime(data.sourceCreatedAt) }]
            : []),
          ...(data.sourceUpdatedAt
            ? [{ label: "来源更新时间", value: dateTime(data.sourceUpdatedAt) }]
            : []),
        ]}
      />
    </section>
  );
}
