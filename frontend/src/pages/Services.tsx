import type { Navigate } from "../navigation";
import SourceRecords from "../components/SourceRecords";
import PlanTaskModal from "../components/PlanTaskModal";
import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  Plus,
} from "lucide-react";
import {
  entityName,
  useCatalog,
  useData,
  useList,
  write,
  type Entity,
} from "../api";
import { dateTime, REGIONS, statusLabel } from "../domain";
import { useUser } from "../context";
import {
  ActionModal,
  History,
  Provenance,
  useMutationFeedback,
} from "../components/Workflow";
import {
  Button,
  DataTable,
  Details,
  Empty,
  EntityForm,
  Modal,
  ListFooter,
  PageHeader,
  SearchBox,
  Select,
  Status,
  Tabs,
  Unavailable,
  type Field,
} from "../components/UI";
const kinds = [
  { value: "DAILY", label: "日常计划" },
  { value: "LONG_TERM", label: "长期计划" },
  { value: "DEVICE_ADMISSION", label: "设备准入" },
  { value: "PILOT_ADMISSION", label: "人员准入" },
];
const planFields: Field[] = [
  { key: "title", label: "申请名称", required: true, wide: true },
  { key: "kind", label: "申请类型", required: true, options: kinds },
  {
    key: "region",
    label: "适用区域",
    required: true,
    options: REGIONS.map((v) => ({ value: v, label: v })),
  },
  { key: "startAt", label: "开始时间", type: "datetime-local", required: true },
  { key: "endAt", label: "结束时间", type: "datetime-local", required: true },
  { key: "height", label: "申请高度（米）", type: "number" },
  { key: "materialName", label: "资格 / 材料名称" },
  { key: "materialNumber", label: "证照 / 材料编号" },
  { key: "validFrom", label: "材料有效起始日", type: "date" },
  { key: "validUntil", label: "材料有效截止日", type: "date" },
  {
    key: "scope",
    label: "飞行范围 / 材料说明",
    type: "textarea",
    required: true,
    wide: true,
  },
];
export default function Services({
  navigate,
  planId,
  taskId,
}: {
  navigate?: Navigate;
  planId?: string;
  taskId?: string;
}) {
  const user = useUser();
  const manage = ["ADMIN", "DISPATCH"].includes(user.role);
  const [tab, setTab] = useState("applications");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [selected, setSelected] = useState<Entity | null>(
    planId ? { id: planId } : null,
  );
  const [create, setCreate] = useState<string | null>(null);
  const [action, setAction] = useState("");
  const [editing, setEditing] = useState(false);
  const [taskPlan, setTaskPlan] = useState<Entity | null>(null);
  const query = useList("/plans", { status: filter, keyword: search, kind });
  const dashboard = useData<{ planCounts: Record<string, number> }>(
    "/dashboard",
  );
  const organizations = useCatalog("/organizations");
  const resources = useCatalog("/resources");
  const tasks = useCatalog("/tasks", {}, manage);
  const consultations = useList("/consultations", { keyword: search });
  const mutate = useMutationFeedback();
  const rows = query.data?.items || [];
  const selectedId =
    tab === "applications" ? selected?.id || rows[0]?.id : undefined;
  const detail = useData<Entity>(
    `/plans/${selectedId || "none"}`,
    !!selectedId,
  );
  const current = selectedId ? detail.data || selected || rows[0] : undefined;
  const flightPlan =
    !!current && ["DAILY", "LONG_TERM"].includes(String(current.kind));
  const linkedTasks = useList(
    `/plans/${current?.id || "none"}/tasks`,
    { pageSize: 20 },
    flightPlan,
  );
  const arrange = ["ADMIN", "DISPATCH", "DEPARTMENT"].includes(user.role);
  const canEditCurrent =
    !!current && (user.role !== "PILOT" || current.createdBy === user.id);
  const fields: Field[] = [
    ...planFields,
    ...(manage
      ? [
          {
            key: "organizationId",
            label: "申请部门",
            required: true,
            options: (organizations.data?.items || []).map((r) => ({
              value: r.id,
              label: entityName(r),
            })),
          },
        ]
      : []),
    {
      key: "resourceId",
      label: "关联设备 / 人员档案",
      options: (resources.data?.items || [])
        .filter((r) => ["DEVICE", "PERSON"].includes(String(r.kind)))
        .map((r) => ({ value: r.id, label: entityName(r) })),
    },
    ...(manage
      ? [
          {
            key: "taskId",
            label: "关联已有任务（可选）",
            options: (tasks.data?.items || []).map((r) => ({
              value: r.id,
              label: entityName(r),
            })),
          },
        ]
      : []),
  ];
  const selectedConsult =
    selected && tab === "preflight"
      ? consultations.data?.items.find((r) => r.id === selected.id) || selected
      : null;
  async function createPlan(body: Record<string, unknown>) {
    return mutate(async () => {
      const p = await write("/plans", body);
      await write(`/plans/${p.id}/actions`, { action: "SUBMIT" });
    }, "申请已提交");
  }
  const stage = [
    {
      id: "",
      label: "全部阶段",
      count: dashboard.data
        ? Object.values(dashboard.data.planCounts || {}).reduce(
            (a, b) => a + b,
            0,
          )
        : undefined,
    },
    {
      id: "PENDING_REVIEW",
      label: "待审核",
      count: dashboard.data
        ? (dashboard.data.planCounts?.PENDING_REVIEW ?? 0)
        : undefined,
    },
    {
      id: "RETURNED",
      label: "需补正",
      count: dashboard.data
        ? (dashboard.data.planCounts?.RETURNED ?? 0)
        : undefined,
    },
    {
      id: "APPROVED",
      label: "已办结",
      count: dashboard.data
        ? (dashboard.data.planCounts?.APPROVED ?? 0)
        : undefined,
    },
  ];
  return (
    <div className="page">
      <PageHeader
        title="飞行服务"
        subtitle="计划一次审批，在有效期内安排执行任务，分配、执行与验收在任务调度办理"
      >
        {taskId && navigate && (
          <Button onClick={() => navigate("dispatch", { taskId })}>
            返回关联任务
          </Button>
        )}
        <Select
          label="工作内容"
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelected(null);
          }}
          options={[
            { value: "applications", label: "办理事项" },
            { value: "preflight", label: "飞前服务" },
            ...(manage ? [{ value: "source", label: "来源计划" }] : []),
          ]}
        />
        <Button onClick={() => setCreate("admission")}>准入申请</Button>
        <Button primary onClick={() => setCreate("plan")}>
          <Plus size={14} />
          飞行计划申请
        </Button>
      </PageHeader>
      {tab === "source" ? (
        <div className="content-pad">
          <h2>来源计划</h2>
          <p className="muted">真实外部计划档案，保留来源状态和计划时间。</p>
          <SourceRecords kind="plans" />
        </div>
      ) : tab === "applications" ? (
        <>
          <div className="stage-bar">
            <Tabs items={stage} value={filter} onChange={setFilter} />
            <small>申请人补正 · 一次审核与回执登记</small>
          </div>
          <div className="split-workspace">
            <aside className="queue">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="搜索申请名称或编号"
              />
              <Select
                label="事项类型"
                value={kind}
                onChange={setKind}
                options={[{ value: "", label: "全部事项" }, ...kinds]}
              />
              <div className="queue-label">
                办理队列<span>{query.data?.total ?? 0} 项</span>
              </div>
              {rows.map((r) => (
                <button
                  className={`queue-card ${current?.id === r.id ? "selected" : ""}`}
                  key={r.id}
                  onClick={() => setSelected(r)}
                >
                  <div>
                    <span className="text-link">
                      <FileCheck2 size={13} />
                      {kinds.find((k) => k.value === r.kind)?.label ||
                        "飞行计划"}
                    </span>
                    <Status status={r.status} />
                  </div>
                  <strong>{entityName(r)}</strong>
                  <small>
                    <Clock3 size={12} />
                    {dateTime(r.startAt)}
                  </small>
                  <p>{r.receiptNumber ? "外部回执已登记" : "回执待登记"}</p>
                  <footer>
                    <span>{String(r.number || r.id)}</span>
                    <ArrowRight size={12} />
                  </footer>
                </button>
              ))}
              {!rows.length && (
                <Empty
                  loading={query.isLoading}
                  error={query.error}
                  title="暂无办理事项"
                  description="提交飞行计划或准入申请后开始办理。"
                />
              )}
              <ListFooter page={query.data} onChange={query.setPage} />
            </aside>
            <main className="workspace-detail">
              {current ? (
                <>
                  <div className="object-heading">
                    <div className="object-icon">
                      <FileCheck2 size={20} />
                    </div>
                    <div>
                      <small>
                        {kinds.find((k) => k.value === current.kind)?.label ||
                          "飞行计划"}{" "}
                        · {String(current.number || current.id)}
                      </small>
                      <h2>{entityName(current)}</h2>
                    </div>
                    <Status status={current.status} />
                  </div>
                  <div className="progress-line">
                    <span>
                      <CheckCircle2 size={13} />
                      申请提交
                    </span>
                    <i />
                    <span>
                      <Clock3 size={13} />
                      一次审核
                    </span>
                    <i />
                    <span>
                      <FileText size={13} />
                      结果归档
                    </span>
                    <small>本系统业务办理</small>
                  </div>
                  <div className="detail-columns">
                    <div>
                      <section className="section">
                        <div className="section-title">
                          <h3>申请档案</h3>
                          <span>原申请与办理记录持续留存</span>
                        </div>
                        <Details
                          items={[
                            {
                              label: "飞行范围 / 材料说明",
                              value: String(current.scope || "—"),
                            },
                            { label: "适用区域", value: current.region },
                            {
                              label: "申请高度",
                              value: current.height
                                ? `${current.height} m`
                                : "—",
                            },
                            {
                              label: "开始时间",
                              value: dateTime(current.startAt),
                            },
                            {
                              label: "结束时间",
                              value: dateTime(current.endAt),
                            },
                            {
                              label: "审批回执",
                              value: String(current.receiptNumber || "—"),
                            },
                            {
                              label: "资格 / 材料",
                              value: String(current.materialName || "—"),
                            },
                            {
                              label: "证照 / 材料编号",
                              value: String(current.materialNumber || "—"),
                            },
                            {
                              label: "材料有效期",
                              value: `${current.validFrom ?? "—"} 至 ${current.validUntil ?? "—"}`,
                            },
                          ]}
                        />
                      </section>
                      {flightPlan && (
                        <section
                          className="section plan-execution-tasks"
                          data-testid="plan-execution-tasks"
                          aria-label="计划关联执行任务"
                        >
                          <div className="section-title">
                            <div>
                              <h3>执行任务</h3>
                              <span>
                                已关联 {linkedTasks.data?.total ?? "—"} 条 ·
                                每条任务独立分配、执行和验收
                              </span>
                            </div>
                            <div className="action-strip">
                              {navigate && (
                                <Button
                                  small
                                  onClick={() =>
                                    navigate("dispatch", { planId: current.id })
                                  }
                                >
                                  查看全部任务 <ArrowRight size={12} />
                                </Button>
                              )}
                            </div>
                          </div>
                          <p className="plan-execution-note">
                            {current.status === "APPROVED"
                              ? "计划已审批通过，安排的任务直接进入待分配，沿用审批结果。长期计划可按实际作业需要安排多次任务。"
                              : "审核通过后即可在此安排执行任务；已有任务保留办理记录，未通过审批时不能开始新的飞行作业。"}
                          </p>
                          <DataTable
                            rows={linkedTasks.data?.items || []}
                            loading={linkedTasks.isLoading}
                            error={linkedTasks.error}
                            emptyTitle="尚未安排执行任务"
                            emptyDescription={
                              current.status === "APPROVED" && arrange
                                ? "点击“安排执行任务”，填写本次作业时段后进入任务调度。"
                                : "计划审核通过后，由需求部门或调度安排执行任务。"
                            }
                            columns={[
                              {
                                key: "title",
                                label: "任务名称",
                                render: (task) => (
                                  <div className="name-cell">
                                    <strong>{entityName(task)}</strong>
                                    <small>
                                      {String(task.number || task.id)}
                                    </small>
                                  </div>
                                ),
                              },
                              {
                                key: "startAt",
                                label: "作业时段",
                                render: (task) => (
                                  <div>
                                    {dateTime(task.startAt)}
                                    <small>至 {dateTime(task.endAt)}</small>
                                  </div>
                                ),
                              },
                              {
                                key: "deviceId",
                                label: "执行设备",
                                render: (task) =>
                                  task.deviceId
                                    ? resources.data?.items.some(
                                        (resource) =>
                                          resource.id === task.deviceId,
                                      )
                                      ? entityName(
                                          resources.data?.items.find(
                                            (resource) =>
                                              resource.id === task.deviceId,
                                          ),
                                        )
                                      : "设备档案不可见"
                                    : "待分配",
                              },
                              {
                                key: "status",
                                label: "任务阶段",
                                render: (task) => (
                                  <Status status={task.status} />
                                ),
                              },
                              {
                                key: "operation",
                                label: "操作",
                                render: (task) =>
                                  navigate && (
                                    <Button
                                      small
                                      onClick={() =>
                                        navigate("dispatch", {
                                          taskId: task.id,
                                          planId: current.id,
                                        })
                                      }
                                    >
                                      查看任务 <ArrowRight size={12} />
                                    </Button>
                                  ),
                              },
                            ]}
                          />
                          <ListFooter
                            page={linkedTasks.data}
                            onChange={linkedTasks.setPage}
                          />
                        </section>
                      )}
                      <Provenance record={current} />
                      <History path={`/plans/${current.id}`} />
                    </div>
                    <aside className="handling">
                      <h3>当前办理</h3>
                      <Status status={current.status} />
                      <div className="handling-card">
                        <strong>{statusLabel(current.status)}</strong>
                        <p>
                          {flightPlan
                            ? "一次审核通过后安排执行任务，任务沿用审批结果；外部回执可另行登记。"
                            : "准入事项记录设备或人员资格，不生成飞行任务。"}
                        </p>
                        {flightPlan &&
                          current.status === "APPROVED" &&
                          arrange && (
                            <Button
                              primary
                              disabled={!!detail.error || detail.isLoading}
                              onClick={() => setTaskPlan(current)}
                            >
                              安排执行任务
                            </Button>
                          )}
                        {current.status === "PENDING_REVIEW" && manage && (
                          <>
                            <Button
                              primary
                              onClick={() => setAction("APPROVE")}
                            >
                              核验通过
                            </Button>
                            <Button onClick={() => setAction("RETURN")}>
                              退回补正
                            </Button>
                          </>
                        )}
                        {!canEditCurrent && (
                          <p>任务关联计划只读，请由申请人或调度办理。</p>
                        )}
                        {canEditCurrent &&
                          ["DRAFT", "RETURNED"].includes(
                            current.status || "",
                          ) && (
                            <>
                              <Button onClick={() => setEditing(true)}>
                                编辑申请
                              </Button>
                              <Button
                                primary
                                onClick={() => setAction("SUBMIT")}
                              >
                                重新提交
                              </Button>
                            </>
                          )}
                        {current.status === "APPROVED" && manage && (
                          <Button onClick={() => setAction("REGISTER_RECEIPT")}>
                            登记外部回执
                          </Button>
                        )}
                        {canEditCurrent &&
                          !["CANCELLED", "APPROVED"].includes(
                            current.status || "",
                          ) && (
                            <Button onClick={() => setAction("CANCEL")}>
                              取消申请
                            </Button>
                          )}
                      </div>
                    </aside>
                  </div>
                </>
              ) : (
                <Empty
                  title="选择办理事项"
                  description="申请详情、材料与办理记录将在这里显示。"
                />
              )}
            </main>
          </div>
        </>
      ) : (
        <div className="content-pad">
          <div className="preflight-cards">
            <Unavailable
              title="气象服务尚未接入"
              description="机巢环境观测接入后可在设备档案中查看。"
            />
            <div className="panel section">
              <h3>飞行准备参考</h3>
              <p className="muted">
                核对飞行计划、设备与人员资格、作业范围和外部回执。
              </p>
            </div>
          </div>
          <div className="table-toolbar">
            <div>
              <h2>咨询与培训事项</h2>
              <p>登记需求、值守答复与申请人反馈</p>
            </div>
            <Button primary onClick={() => setCreate("consultation")}>
              <Plus size={14} />
              登记服务需求
            </Button>
          </div>
          <DataTable
            rows={consultations.data?.items || []}
            onRow={setSelected}
            loading={consultations.isLoading}
            error={consultations.error}
            columns={[
              { key: "title", label: "服务主题" },
              { key: "kind", label: "事项类型" },
              { key: "region", label: "区域" },
              {
                key: "status",
                label: "办理状态",
                render: (r) => <Status status={r.status} />,
              },
              {
                key: "createdAt",
                label: "提交时间",
                render: (r) => dateTime(r.createdAt),
              },
            ]}
          />
          <ListFooter
            page={consultations.data}
            onChange={consultations.setPage}
          />
        </div>
      )}
      {taskPlan && (
        <PlanTaskModal
          key={taskPlan.id}
          plan={taskPlan}
          organizationName={
            entityName(
              organizations.data?.items.find(
                (organization) => organization.id === taskPlan.organizationId,
              ),
            ) === "未命名"
              ? "当前申请部门"
              : entityName(
                  organizations.data?.items.find(
                    (organization) =>
                      organization.id === taskPlan.organizationId,
                  ),
                )
          }
          onClose={() => setTaskPlan(null)}
          onCreated={(task) => {
            setTaskPlan(null);
            navigate?.("dispatch", {
              taskId: task.id,
              planId: String(task.planId || taskPlan.id),
            });
          }}
        />
      )}
      {editing && current && (
        <Modal title="编辑补正申请" onClose={() => setEditing(false)}>
          <EntityForm
            fields={fields}
            initial={current}
            onCancel={() => setEditing(false)}
            submitLabel="保存修改"
            onSubmit={(body) =>
              mutate(() => {
                const payload = { ...body };
                if (!manage) delete payload.taskId;
                return write(`/plans/${current.id}`, payload, "PUT");
              }, "申请修改已保存")
            }
          />
        </Modal>
      )}
      {create && (
        <Modal
          title={
            create === "consultation"
              ? "登记咨询与培训"
              : create === "admission"
                ? "提交准入申请"
                : "飞行计划申请"
          }
          onClose={() => setCreate(null)}
        >
          <EntityForm
            onCancel={() => setCreate(null)}
            submitLabel="提交申请"
            fields={
              create === "consultation"
                ? [
                    {
                      key: "title",
                      label: "服务主题",
                      required: true,
                      wide: true,
                    },
                    {
                      key: "kind",
                      label: "服务类型",
                      required: true,
                      options: [
                        { value: "CONSULTATION", label: "咨询" },
                        { value: "TRAINING", label: "培训" },
                      ],
                    },
                    {
                      key: "region",
                      label: "所属区域",
                      required: true,
                      options: REGIONS.map((v) => ({ value: v, label: v })),
                    },
                    {
                      key: "description",
                      label: "需求说明",
                      type: "textarea",
                      required: true,
                      wide: true,
                    },
                  ]
                : fields
            }
            initial={{
              organizationId: user.organizationId,
              kind:
                create === "consultation"
                  ? "CONSULTATION"
                  : create === "admission"
                    ? "DEVICE_ADMISSION"
                    : "DAILY",
            }}
            onSubmit={(body) =>
              create === "consultation"
                ? mutate(() => write("/consultations", body), "服务需求已登记")
                : createPlan(body)
            }
          />
        </Modal>
      )}
      {current && action && tab === "applications" && (
        <ActionModal
          path={`/plans/${current.id}`}
          action={action}
          title={
            {
              APPROVE: "核验通过",
              RETURN: "退回补正",
              SUBMIT: "重新提交",
              CANCEL: "取消申请",
              REGISTER_RECEIPT: "登记外部回执",
            }[action] || action
          }
          fields={
            action === "REGISTER_RECEIPT"
              ? [
                  {
                    key: "receiptNumber",
                    label: "外部回执编号",
                    required: true,
                  },
                  {
                    key: "receiptBasis",
                    label: "回执核对依据",
                    type: "textarea",
                    required: true,
                    wide: true,
                  },
                ]
              : []
          }
          onClose={() => setAction("")}
        />
      )}{" "}
      {selectedConsult && (
        <Modal
          title={entityName(selectedConsult)}
          onClose={() => setSelected(null)}
        >
          <Details
            items={[
              {
                label: "需求说明",
                value: String(selectedConsult.description || "—"),
              },
              {
                label: "答复内容",
                value: String(
                  selectedConsult.answer || selectedConsult.reply || "—",
                ),
              },
            ]}
          />
          {selectedConsult.status === "OPEN" && manage && (
            <EntityForm
              fields={[
                {
                  key: "reply",
                  label: "答复内容",
                  type: "textarea",
                  required: true,
                  wide: true,
                },
              ]}
              submitLabel="提交答复"
              onCancel={() => setSelected(null)}
              onSubmit={(body) =>
                mutate(
                  () =>
                    write(`/consultations/${selectedConsult.id}/actions`, {
                      ...body,
                      action: "REPLY",
                    }),
                  "答复已登记",
                )
              }
            />
          )}{" "}
          {selectedConsult.status === "ANSWERED" && (
            <Button
              primary
              onClick={() =>
                void mutate(
                  () =>
                    write(`/consultations/${selectedConsult.id}/actions`, {
                      action: "COMPLETE",
                    }),
                  "事项已完成",
                )
              }
            >
              确认完成
            </Button>
          )}
          <Provenance record={selectedConsult} />
          <History path={`/consultations/${selectedConsult.id}`} />
        </Modal>
      )}
    </div>
  );
}
