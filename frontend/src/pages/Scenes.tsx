import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Flame,
  MapPin,
  Plus,
  ScanLine,
} from "lucide-react";
import { entityName, useCatalog, useData, useList, type Entity } from "../api";
import { useUser } from "../context";
import type { Navigate } from "../navigation";
import {
  ActionModal,
  History,
  Provenance,
} from "../components/Workflow";
import {
  Button,
  Empty,
  ListFooter,
  SearchBox,
  Select,
  Status,
} from "../components/UI";
import CaseEvidence from "./scenes/CaseEvidence";
import "./scenes/scenes.css";

const scenes = ["森林防火", "矿产监管", "河道巡查", "非现执法"];
const caseSteps = ["复核", "移交", "处置", "复查", "归档"];
const caseStepIndex: Record<string, number> = {
  PENDING_REVIEW: 0,
  PENDING_TRANSFER: 1,
  PENDING_DISPOSAL: 2,
  RESOLVED: 3,
  ARCHIVED: 4,
};
const caseStatusLabels: Record<string, string> = {
  PENDING_REVIEW: "待复核",
  PENDING_TRANSFER: "待移交",
  PENDING_DISPOSAL: "待处置",
  RESOLVED: "待复查",
  ARCHIVED: "已归档",
};

function shortCaseId(record: Entity) {
  const number = record.number;
  if (number) return String(number);
  return `CASE-${String(record.id).slice(0, 8).toUpperCase()}`;
}

export default function Scenes({
  navigate,
  initialCaseId,
}: {
  navigate: Navigate;
  initialCaseId?: string;
}) {
  const user = useUser();
  const canHandle = user.role !== "PILOT";
  const [scene, setScene] = useState("森林防火");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(initialCaseId ? { id: initialCaseId } : null);
  const [action, setAction] = useState("");
  const query = useList("/cases", {
    scene,
    keyword: search,
    status: archived ? "ARCHIVED" : undefined,
    excludeStatus: archived ? undefined : "ARCHIVED",
  });
  const openItems = useList("/cases", { scene, excludeStatus: "ARCHIVED", pageSize: 1 });
  const archivedItems = useList("/cases", { scene, status: "ARCHIVED", pageSize: 1 });
  const review = useList("/cases", { scene, status: "PENDING_REVIEW", pageSize: 1 });
  const transfer = useList("/cases", { scene, status: "PENDING_TRANSFER", pageSize: 1 });
  const disposal = useList("/cases", { scene, status: "PENDING_DISPOSAL", pageSize: 1 });
  const tasks = useList("/tasks");
  const attachments = useCatalog("/attachments");
  const rows = query.data?.items || [];
  const selectedId = selected?.id || rows[0]?.id;
  const detail = useData<Entity>(`/cases/${selectedId || "none"}`, !!selectedId);
  useEffect(() => {
    if (initialCaseId && detail.data?.scene) setScene(String(detail.data.scene));
  }, [detail.data?.scene, initialCaseId]);
  const current = detail.data || selected || rows[0];
  const linkedTask = useData<Entity>(
    `/tasks/${current?.taskId || "none"}`,
    !!current?.taskId,
  );
  const attachmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (attachments.data?.items || []).forEach((file) => {
      const caseId = String(file.caseId || "");
      if (caseId) counts.set(caseId, (counts.get(caseId) || 0) + 1);
    });
    return counts;
  }, [attachments.data?.items]);
  const stageIndex = current ? caseStepIndex[String(current.status)] ?? -1 : -1;

  return (
    <div className="page scene-page">
      <header className="page-header scene-page-header">
        <div className="scene-page-title">
          <div className="scene-page-title-row">
            <h1>场景应用</h1>
            <Select
              label="工作内容"
              value={scene}
              onChange={(value) => {
                setScene(value);
                setSelected(null);
                setSearch("");
              }}
              options={[{ value: "", label: "全部" }, ...scenes]}
            />
          </div>
          <p>
            {!scene
              ? "现场线索、证据复核与处置跟踪"
              : scene === "森林防火"
                ? "林区巡护、疑似火点复核与处置跟踪"
                : `${scene}事项核查、复核与处置跟踪`}
          </p>
        </div>
        <div className="header-actions">
          <div className="scene-header-summary">
            <span>未结事项 <strong>{openItems.data?.total ?? "—"}</strong></span>
            <span>已归档 <strong>{archivedItems.data?.total ?? "—"}</strong></span>
          </div>
        </div>
      </header>

      <div className="split-workspace scene-workspace">
        <aside className="queue scene-queue" aria-label="场景线索列表">
          <div className="scene-counts">
            <div><strong>{review.data?.total ?? "—"}</strong>待复核</div>
            <div><strong>{transfer.data?.total ?? "—"}</strong>待移交</div>
            <div><strong>{disposal.data?.total ?? "—"}</strong>待处置</div>
          </div>
          <SearchBox value={search} onChange={setSearch} placeholder="搜索线索、区域或案件号" />
          <Select
            label="事项状态"
            value={archived ? "archived" : "open"}
            onChange={(value) => {
              setArchived(value === "archived");
              setSelected(null);
            }}
            options={[
              { value: "open", label: "未结事项" },
              { value: "archived", label: "已归档" },
            ]}
          />
          <div className="queue-label">
            {scene === "森林防火" ? "林区事项" : scene ? `${scene}事项` : "行业事项"}
            <span>{query.data?.total ?? "—"}</span>
          </div>
          {rows.map((record) => {
            const count = attachmentCounts.get(record.id) || 0;
            return (
              <button
                key={record.id}
                className={`queue-card scene-queue-card ${record.id === current?.id ? "selected" : ""}`}
                onClick={() => setSelected(record)}
              >
                <div><Flame size={14} /><Status status={record.status} label={caseStatusLabels[String(record.status)]} /></div>
                <strong>{entityName(record)}</strong>
                <small><MapPin size={12} />{String(record.region || "区域未记录")}</small>
                <p>{count} 份现场证据</p>
                <footer><span>{shortCaseId(record)}</span><ArrowRight size={12} /></footer>
              </button>
            );
          })}
          {!rows.length && (
            <Empty
              loading={query.isLoading}
              error={query.error}
              title="当前没有场景事项"
              description="已授权的待办理线索会显示在这里。"
            />
          )}
          <ListFooter page={query.data} onChange={query.setPage} />
          <p className="footnote">飞行任务与行业处置分别跟踪</p>
        </aside>

        <main className="workspace-detail scene-detail">
          {current ? (
            <>
              <div className="object-heading scene-object-heading">
                <div>
                  <small>{shortCaseId(current)} <span>/</span> {String(current.region || "区域未记录")}</small>
                  <h2>{entityName(current)}</h2>
                  {Boolean(current.taskId) && (
                    <button className="scene-task-link" onClick={() => navigate("dispatch", { taskId: String(current.taskId) })}>
                      来源任务 {entityName(linkedTask.data || tasks.data?.items.find((task) => task.id === current.taskId))}
                      <ArrowRight size={12} />
                    </button>
                  )}
                </div>
                <Status status={current.status} label={caseStatusLabels[String(current.status)]} />
              </div>

              <div className="scene-detail-layout">
                <div className="scene-evidence-column">
                  <details className="scene-description" open>
                    <summary>线索说明 <ChevronDown size={13} /></summary>
                    <p>{String(current.description || "暂无线索说明")}</p>
                  </details>

                  <CaseEvidence
                    key={current.id}
                    record={current}
                    readOnly={current.status === "ARCHIVED"}
                    navigate={navigate}
                  />

                  <details className="scene-recognition">
                    <summary>
                      <span><ScanLine size={14} />算法发现与人工认定</span>
                      <small>识别观测仅在明确关联后纳入本线索</small>
                      <ChevronDown size={13} />
                    </summary>
                    <div>
                      <p>当前线索没有可追溯的关联识别编号。平台不会按设备或相近时间自动认定来源观测属于本案。</p>
                      <Button small onClick={() => navigate("algorithms")}>查看来源识别记录</Button>
                    </div>
                  </details>

                  <section className="scene-related-task" aria-label="关联飞行任务">
                    <header><strong>巡护与现场核查</strong><span>{current.taskId ? "1" : "0"}</span></header>
                    {current.taskId ? (
                      <button onClick={() => navigate("dispatch", { taskId: String(current.taskId) })}>
                        <span><small>来源任务</small><strong>{entityName(linkedTask.data || tasks.data?.items.find((task) => task.id === current.taskId))}</strong><small>{String(linkedTask.data?.id || current.taskId)}</small></span>
                        <Status status={String(linkedTask.data?.status || "UNKNOWN")} />
                        <ArrowRight size={13} />
                      </button>
                    ) : (
                      <p>本线索暂未关联飞行任务。</p>
                    )}
                  </section>
                  {linkedTask.error && Boolean(current.taskId) && (
                    <p className="scene-inline-error" role="alert">关联任务读取失败：{linkedTask.error.message}</p>
                  )}
                  <Provenance record={current} />
                </div>

                <aside className="handling scene-handling" aria-label="当前办理">
                  <div className="scene-handling-heading">
                    <h3>当前办理</h3>
                    <Status status={current.status} label={caseStatusLabels[String(current.status)]} />
                  </div>
                  <div className="case-steps scene-case-steps">
                    {caseSteps.map((label, index) => (
                      <div key={label} className={index < stageIndex ? "complete" : index === stageIndex ? "active" : ""}>
                        <span>{index < stageIndex ? "✓" : index + 1}</span>{label}
                      </div>
                    ))}
                  </div>
                  <p className="muted">结合现场影像与线索说明进行人工核实。来源识别结果仅作辅助，不自动认定为事实。</p>
                  {canHandle && current.status !== "ARCHIVED" && (
                    <div className="handling-card scene-handling-card">
                      {current.status === "PENDING_REVIEW" && (
                        <>
                          <Button primary onClick={() => setAction("VERIFY")}>填写复核结论 <Plus size={13} /></Button>
                          <Button onClick={() => setAction("DISMISS")}>认定无效并归档</Button>
                        </>
                      )}
                      {current.status === "PENDING_TRANSFER" && (
                        <Button primary onClick={() => setAction("TRANSFER")}>安排现场核查</Button>
                      )}
                      {current.status === "PENDING_DISPOSAL" && (
                        <Button primary onClick={() => setAction("RESOLVE")}>登记处置结果</Button>
                      )}
                      {current.status === "RESOLVED" && (
                        <Button primary onClick={() => setAction("ARCHIVE")}>复查确认并归档</Button>
                      )}
                    </div>
                  )}
                  <section className="scene-coordination">
                    <h4>火情与林业协同记录</h4>
                    <History path={`/cases/${current.id}`} />
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <Empty
              title="选择场景事项"
              description="现场证据、人工结论、关联任务与办理过程会在这里汇总。"
            />
          )}
        </main>
      </div>

      {current && action && (
        <ActionModal
          path={`/cases/${current.id}`}
          action={action}
          title={{
            VERIFY: "填写复核结论",
            DISMISS: "认定无效并归档",
            TRANSFER: "安排现场核查",
            RESOLVE: "登记处置结果",
            ARCHIVE: "复查确认并归档",
          }[action] || action}
          fields={action === "TRANSFER" || action === "ARCHIVE" ? [] : [{ key: "conclusion", label: action === "VERIFY" ? "复核结论" : "处置结论", type: "textarea", required: true, wide: true }]}
          onClose={() => setAction("")}
          closeOnSuccess
        />
      )}
    </div>
  );
}
