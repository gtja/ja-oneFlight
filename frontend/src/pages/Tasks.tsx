import type { Navigate } from "../navigation";
import "./experience.css";
import "./tasks/taskScheduling.css";
import { taskNextStep } from "../taskWorkflow";
import { flightPlanCompatibility } from "../flightPlanLink";
import SourceRecords from "../components/SourceRecords";
import TaskAssignmentModal from "../components/TaskAssignmentModal";
import RequestAssistant from "./tasks/RequestAssistant";
import TaskScheduleCalendar, {
  calendarToday,
  scheduleDateKey,
  scheduleTimeLabel,
  type ScheduleView,
} from "./tasks/TaskScheduleCalendar";
import TaskRequestForm from "./tasks/TaskRequestForm";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CalendarDays,
  Clock3,
  Inbox,
  List,
  Plus,
  WandSparkles,
} from "lucide-react";
import {
  entityName,
  useCatalog,
  useData,
  useList,
  write,
  type Entity,
} from "../api";
import { REGIONS, SCENES, dateTime, statusLabel } from "../domain";
import { useUser } from "../context";
import {
  ActionModal,
  Attachments,
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
  PageHeader,
  SearchBox,
  Select,
  Status,
  type Field,
} from "../components/UI";
const taskFields: Field[] = [
  { key: "title", label: "任务名称", required: true, wide: true },
  {
    key: "scene",
    label: "应用场景",
    required: true,
    options: SCENES.map((v) => ({ value: v, label: v })),
  },
  {
    key: "region",
    label: "作业区域",
    required: true,
    options: REGIONS.map((v) => ({ value: v, label: v })),
  },
  {
    key: "startAt",
    label: "期望开始时间",
    type: "datetime-local",
    required: true,
  },
  {
    key: "endAt",
    label: "期望结束时间",
    type: "datetime-local",
    required: true,
  },
  {
    key: "priority",
    label: "紧急程度",
    options: [
      { value: "NORMAL", label: "常规" },
      { value: "URGENT", label: "紧急" },
    ],
  },
  {
    key: "description",
    label: "作业要求",
    type: "textarea",
    required: true,
    wide: true,
  },
];

function TaskScheduleFooter({
  page,
  visibleCount,
  onChange,
}: {
  page?: { page: number; pageSize: number; total: number };
  visibleCount: number;
  onChange: (page: number) => void;
}) {
  const pageCount = page ? Math.ceil(page.total / page.pageSize) : 0;
  return (
    <div className="list-footer task-schedule-footer">
      <span>任务与作业、架次分别记录</span>
      <span>
        当前显示 {visibleCount} / {page?.total ?? "—"}
        {page && pageCount > 1 && (
          <span className="task-schedule-pagination">
            <Button small disabled={page.page <= 1} onClick={() => onChange(page.page - 1)}>
              上一页
            </Button>
            {page.page} / {pageCount}
            <Button
              small
              disabled={page.page >= pageCount}
              onClick={() => onChange(page.page + 1)}
            >
              下一页
            </Button>
          </span>
        )}
      </span>
    </div>
  );
}

export default function Tasks({
  navigate,
  taskId,
  planId,
  initialAction,
}: {
  navigate: Navigate;
  taskId?: string;
  planId?: string;
  initialAction?: string;
}) {
  const user = useUser();
  const manage = ["ADMIN", "DISPATCH"].includes(user.role);
  const create = manage || user.role === "DEPARTMENT";
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [calendar, setCalendar] = useState(false);
  const [queue, setQueue] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [calendarView, setCalendarView] = useState<ScheduleView>("month");
  const [calendarDate, setCalendarDate] = useState(calendarToday);
  const [fullDay, setFullDay] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [nativeHistory, setNativeHistory] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(
    taskId ? { id: taskId } : null,
  );
  const [showCreate, setShowCreate] = useState(false);
  const [createPriority, setCreatePriority] = useState<"NORMAL" | "URGENT">(
    "NORMAL",
  );
  const creationBusy = useRef(false);
  const [editing, setEditing] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [action, setAction] = useState("");
  const query = useList("/tasks", { status: filter, keyword: search, planId });
  const dashboard = useData<{
    taskTotal: number;
    taskCounts: Record<string, number>;
  }>("/dashboard");
  const organizations = useList("/organizations");
  const resources = useCatalog("/resources", { kind: "DEVICE" });
  const pilots = useList("/users", { role: "PILOT" }, manage);
  const plans = useCatalog("/plans");
  const mutate = useMutationFeedback();
  const rows = query.data?.items || [];
  const detail = useData<Entity>(
    `/tasks/${selected?.id || "none"}`,
    !!selected,
  );
  const current = selected && !detail.error ? detail.data || selected : null;
  const openedAssignment = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      initialAction === "assign" &&
      taskId &&
      current?.id === taskId &&
      current.status === "PENDING_ASSIGNMENT" &&
      manage &&
      openedAssignment.current !== taskId
    ) {
      openedAssignment.current = taskId;
      setAction("ASSIGN");
    }
  }, [current?.id, current?.status, initialAction, manage, taskId]);
  const currentPlanQuery = useData<Entity>(
    `/plans/${current?.planId || "none"}`,
    !!current?.planId,
    5000,
  );
  const currentPlan = currentPlanQuery.data;
  const filteredPlan = useData<Entity>(
    `/plans/${planId || "none"}`,
    !!planId,
    5000,
  );
  const currentPlanMatch =
    current && currentPlan
      ? flightPlanCompatibility(current, currentPlan)
      : undefined;
  const canStart =
    (current?.scene === "资料核对" && !current.planId) ||
    (!!currentPlan &&
      currentPlan.status === "APPROVED" &&
      currentPlanMatch?.allowed &&
      !currentPlanQuery.error);
  const startReason = currentPlanQuery.error
    ? "关联计划暂不可读取，请恢复后再开始执行。"
    : !current?.planId
      ? "请先关联飞行计划并完成审批。"
      : currentPlanMatch && !currentPlanMatch.allowed
        ? currentPlanMatch.reason
        : currentPlan?.status !== "APPROVED"
          ? "关联飞行计划审批通过后才能开始执行。"
          : "登记本系统任务进度，不发送设备指令。";
  const nextStep = current
    ? taskNextStep(current, user.role, currentPlan)
    : undefined;
  const flightPlanOptions = (plans.data?.items || [])
    .filter(
      (plan) =>
        ["DAILY", "LONG_TERM"].includes(String(plan.kind)) &&
        plan.status !== "CANCELLED" &&
        !!current &&
        flightPlanCompatibility(current, plan).allowed,
    )
    .map((plan) => ({
      value: plan.id,
      label: `${entityName(plan)} · ${statusLabel(plan.status)}`,
      status: plan.status,
    }));
  function deviceCaption(id: unknown) {
    if (!id) return "待分配";
    if (resources.isLoading) return "设备资料加载中";
    if (resources.error) return "设备资料暂不可用";
    const resource = resources.data?.items.find((item) => item.id === id);
    return resource ? entityName(resource) : "设备档案不可见";
  }
  function pilotCaption(id: unknown) {
    if (!id) return "";
    if (id === user.id) return user.displayName;
    const pilot = pilots.data?.items.find((item) => item.id === id);
    return pilot ? String(pilot.displayName || pilot.title) : "已分配执行人员";
  }
  function organizationCaption(task: Entity) {
    if (task.organizationName) return String(task.organizationName);
    const organization = organizations.data?.items.find(
      (item) =>
        String(item.organizationId || item.id || "") ===
        String(task.organizationId || ""),
    );
    return organization ? entityName(organization) : "本部门";
  }
  const stages = [
    { id: "", label: "全部阶段" },
    { id: "DRAFT", label: statusLabel("DRAFT") },
    { id: "RETURNED", label: statusLabel("RETURNED") },
    { id: "PENDING_ASSIGNMENT", label: statusLabel("PENDING_ASSIGNMENT") },
    { id: "PENDING_EXECUTION", label: statusLabel("PENDING_EXECUTION") },
    { id: "EXECUTING", label: statusLabel("EXECUTING") },
    { id: "PENDING_ACCEPTANCE", label: statusLabel("PENDING_ACCEPTANCE") },
    { id: "COMPLETED", label: statusLabel("COMPLETED") },
    { id: "CANCELLED", label: statusLabel("CANCELLED") },
  ];
  const queueItems = [
    { id: "all", label: "全部任务", statuses: [] as string[] },
    { id: "intake", label: "需求受理", statuses: ["DRAFT", "RETURNED"] },
    {
      id: "planning",
      label: "计划准备",
      statuses: ["PENDING_ASSIGNMENT"],
    },
    {
      id: "flight",
      label: "飞行作业",
      statuses: ["PENDING_EXECUTION", "EXECUTING"],
    },
    {
      id: "acceptance",
      label: "交付验收",
      statuses: ["PENDING_ACCEPTANCE"],
    },
    {
      id: "closed",
      label: "已结案",
      statuses: ["COMPLETED", "CANCELLED"],
    },
  ].map((item) => {
    const count = planId
      ? item.id === "all"
        ? query.data?.total
        : rows.filter((row) => item.statuses.includes(String(row.status))).length
      : !dashboard.data
        ? undefined
        : item.id === "all"
          ? dashboard.data.taskTotal
          : item.statuses.reduce(
              (total, status) =>
                total + (dashboard.data?.taskCounts[status] ?? 0),
              0,
            );
    return { ...item, count };
  });
  const selectedQueue = queueItems.find((item) => item.id === queue) || queueItems[0];
  const queueRows =
    queue === "all"
      ? rows
      : rows.filter((row) =>
          selectedQueue.statuses.includes(String(row.status)),
        );
  const filteredRows = queueRows.filter((row) => {
    const organizationMatches =
      !departmentFilter ||
      String(row.organizationId || "") === departmentFilter ||
      String(row.organizationName || "") === departmentFilter;
    const resourceMatches =
      !resourceFilter || String(row.deviceId || "") === resourceFilter;
    return organizationMatches && resourceMatches;
  });
  const taskCount =
    queue !== "all" || departmentFilter || resourceFilter
      ? filteredRows.length
      : search || filter
        ? (query.data?.total ?? "—")
        : (selectedQueue.count ?? query.data?.total ?? "—");
  const departmentOptions = [
    { value: "", label: "全部需求部门" },
    ...Array.from(
      new Map(
        [
          ...(organizations.data?.items || []),
          ...rows.filter((row) => row.organizationId || row.organizationName),
        ].map((organization) => {
          const id = String(organization.organizationId || organization.id || "");
          const name = String(
            organization.title ||
              organization.name ||
              organization.organizationName ||
              "本部门",
          );
          return [id || name, { value: id || name, label: name }] as const;
        }),
      ).values(),
    ),
  ];
  const resourceOptions = [
    { value: "", label: "全部执行资源" },
    ...(resources.data?.items || []).map((resource) => ({
      value: resource.id,
      label: entityName(resource),
    })),
  ];
  const planOptions = [
    { value: "", label: "全部飞行计划" },
    ...(plans.data?.items || [])
      .filter((plan) => ["DAILY", "LONG_TERM"].includes(String(plan.kind)))
      .map((plan) => ({ value: plan.id, label: entityName(plan) })),
    ...(planId &&
    filteredPlan.data &&
    !plans.data?.items.some((plan) => plan.id === planId)
      ? [{ value: planId, label: entityName(filteredPlan.data) }]
      : []),
  ];
  const actionTitles: Record<string, string> = {
    SUBMIT: "提交需求",
    ASSIGN: "分配执行资源",
    LINK_PLAN: "关联飞行计划",
    START: "登记开始执行",
    FINISH: "提交成果",
    ACCEPT: "验收通过",
    RETURN: "退回完善",
    CANCEL: "取消任务",
  };
  const createFields: Field[] = [
    ...taskFields,
    ...(manage
      ? [
          {
            key: "organizationId",
            label: "需求部门",
            required: true,
            options: (organizations.data?.items || []).map((r) => ({
              value: r.id,
              label: entityName(r),
            })),
          },
        ]
      : []),
  ];
  return (
    <div className="page task-page experience-page task-scheduling-page">
      <PageHeader title="任务调度" subtitle="统一受理 · 统筹排期 · 分别交付">
        <div className="task-more-business">
          <Button
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            onClick={() => setMoreOpen((open) => !open)}
          >
            更多业务 <ChevronDown size={13} />
          </Button>
          {moreOpen && (
            <div
              className="task-more-menu"
              role="dialog"
              aria-label="更多业务"
            >
              <span className="task-more-menu-title">所属飞行计划</span>
              <Select
                label="所属飞行计划"
                value={planId || ""}
                onChange={(value) => {
                  setMoreOpen(false);
                  navigate("dispatch", value ? { planId: value } : undefined);
                }}
                options={planOptions}
              />
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  navigate("services");
                }}
              >
                飞行服务计划
              </button>
              {manage && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setNativeHistory((value) => !value);
                  }}
                >
                  {nativeHistory ? "返回任务办理" : "来源行动（只读）"}
                </button>
              )}
            </div>
          )}
        </div>
        {create && !planId && (
          <Button onClick={() => setAssistant(true)}>
            <WandSparkles size={14} />
            需求助手
          </Button>
        )}
        {create && !planId && (
          <Button
            className="task-emergency-button"
            onClick={() => {
              setCreatePriority("URGENT");
              setShowCreate(true);
            }}
          >
            应急插单
          </Button>
        )}
        {create && (
          <Button
            primary
            onClick={() => {
              if (planId) navigate("services", { planId });
              else {
                setCreatePriority("NORMAL");
                setShowCreate(true);
              }
            }}
          >
            <Plus size={15} />
            {planId ? "从原计划安排任务" : "提报需求"}
          </Button>
        )}
        <div className="segmented task-view-toggle" role="group" aria-label="任务查看方式">
          <button
            className={!calendar ? "active" : ""}
            aria-pressed={!calendar}
            onClick={() => setCalendar(false)}
          >
            <List size={14} />
            列表
          </button>
          <button
            className={calendar ? "active" : ""}
            aria-pressed={calendar}
            onClick={() => setCalendar(true)}
          >
            <CalendarDays size={14} />
            日历
          </button>
        </div>
      </PageHeader>
      {nativeHistory ? (
        <div className="content-pad task-native-history">
          <h2>来源行动档案</h2>
          <p className="muted">
            展示真实上游行动，来源状态与本地调度流程分别记录。
          </p>
          <SourceRecords kind="tasks" />
        </div>
      ) : (
        <div className={`task-scheduling-body ${calendar ? "calendar-open" : ""}`}>
          {!calendar && (
            <aside className="task-queue-panel" aria-label="任务队列">
              <div className="task-queue-title">任务队列</div>
              <nav>
                {queueItems.map((item) => {
                  const Icon =
                    item.id === "all"
                      ? List
                      : item.id === "intake"
                        ? Inbox
                        : item.id === "planning"
                          ? CalendarDays
                          : item.id === "flight"
                            ? Clock3
                            : CheckCircle2;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={queue === item.id ? "active" : ""}
                      aria-pressed={queue === item.id}
                      onClick={() => {
                        setQueue(item.id);
                        setFilter("");
                      }}
                    >
                      <span className="task-queue-label">
                        <Icon size={14} />
                        {item.label}
                      </span>
                      <span className="task-queue-count">{item.count ?? "—"}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>
          )}
          <section className="task-scheduling-content">
            {planId && (
              <div
                className="plan-filter-context task-plan-filter-context"
                role="note"
                data-testid="task-plan-filter"
              >
                <div>
                  <small>当前仅显示计划下的执行任务</small>
                  <strong>
                    {filteredPlan.data
                      ? entityName(filteredPlan.data)
                      : filteredPlan.error
                        ? "计划暂不可读取"
                        : "正在读取计划…"}
                  </strong>
                  <span>
                    {query.data?.total ?? "—"} 条任务 ·
                    取消、完成与验收记录均保留
                  </span>
                </div>
                <div className="action-strip">
                  <Button
                    small
                    onClick={() => navigate("services", { planId })}
                  >
                    返回原计划
                  </Button>
                  <Button small onClick={() => navigate("dispatch")}>
                    清除计划筛选
                  </Button>
                </div>
              </div>
            )}
            {calendar ? (
              <>
                <TaskScheduleCalendar
                  tasks={filteredRows}
                  filters={
                    <div className="task-calendar-filters">
                      <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="搜索任务、编号或区域"
                      />
                      <Select
                        label="任务队列筛选"
                        value={queue}
                        onChange={(value) => {
                          setQueue(value);
                          setFilter("");
                        }}
                        options={queueItems.map((item) => ({
                          value: item.id,
                          label: item.label,
                        }))}
                      />
                      <Select
                        label="需求部门筛选"
                        value={departmentFilter}
                        onChange={setDepartmentFilter}
                        options={departmentOptions}
                      />
                      <Select
                        label="任务阶段"
                        value={filter}
                        onChange={(value) => {
                          setFilter(value);
                          setQueue("all");
                        }}
                        options={stages.map((stage) => ({
                          value: stage.id,
                          label: stage.label,
                        }))}
                      />
                      <Select
                        label="排期资源"
                        value={resourceFilter}
                        onChange={setResourceFilter}
                        options={resourceOptions}
                      />
                    </div>
                  }
                  resources={resources.data?.items || []}
                  resourcesLoading={resources.isLoading}
                  resourcesError={resources.error}
                  selectedDate={calendarDate}
                  view={calendarView}
                  fullDay={fullDay}
                  onSelectedDateChange={setCalendarDate}
                  onViewChange={setCalendarView}
                  onFullDayChange={setFullDay}
                  onTaskSelect={setSelected}
                />
                <TaskScheduleFooter
                  page={query.data}
                  visibleCount={filteredRows.length}
                  onChange={query.setPage}
                />
              </>
            ) : (
              <>
                <div className="task-list-heading">
                  <div>
                    <h2>{selectedQueue.label}</h2>
                    <span>{taskCount} 条任务</span>
                  </div>
                  <small>点击任务查看要求、方案与办理记录</small>
                </div>
                <div className="task-list-filters">
                  <SearchBox
                    value={search}
                    onChange={setSearch}
                    placeholder="搜索任务、编号或区域"
                  />
                  <Select
                    label="需求部门筛选"
                    value={departmentFilter}
                    onChange={setDepartmentFilter}
                    options={departmentOptions}
                  />
                  <Select
                    label="任务阶段"
                    value={filter}
                    onChange={(value) => {
                      setFilter(value);
                      setQueue("all");
                    }}
                    options={stages.map((stage) => ({
                      value: stage.id,
                      label: stage.label,
                    }))}
                  />
                  <Select
                    label="排期资源"
                    value={resourceFilter}
                    onChange={setResourceFilter}
                    options={resourceOptions}
                  />
                </div>
                <div className="task-scheduling-table">
                  <DataTable
                    loading={query.isLoading}
                    error={query.error}
                    rows={filteredRows}
                    onRow={setSelected}
                    columns={[
                      {
                        key: "title",
                        label: "任务与作业目标",
                        render: (r) => (
                          <div className="name-cell">
                            <span className="task-name-line">
                              {r.priority === "URGENT" && (
                                <span className="task-urgent-tag">紧急</span>
                              )}
                              <strong>{entityName(r)}</strong>
                            </span>
                            <small>{String(r.number || r.id)}</small>
                            <small className="task-goal-caption">
                              {String(r.description || "—")}
                            </small>
                          </div>
                        ),
                      },
                      {
                        key: "scene",
                        label: "需求部门 / 场景",
                        render: (r) => (
                          <div>
                            <span>{organizationCaption(r)}</span>
                            <small>
                              {r.region} · {String(r.scene || "—")}
                            </small>
                          </div>
                        ),
                      },
                      {
                        key: "startAt",
                        label: "期望时间",
                        render: (r) => {
                          const startDate = scheduleDateKey(r.startAt);
                          const endDate = scheduleDateKey(r.endAt);
                          const startTime = scheduleTimeLabel(r.startAt);
                          const endTime = scheduleTimeLabel(r.endAt);
                          return (
                            <div className="task-time-cell">
                              <strong>
                                {startTime && endTime
                                  ? `${startTime} — ${endTime}`
                                  : startTime || "待排期"}
                              </strong>
                              <small>
                                {startDate && endDate && startDate !== endDate
                                  ? `${startDate} 至 ${endDate}`
                                  : startDate || "时间待定"}
                              </small>
                            </div>
                          );
                        },
                      },
                      {
                        key: "deviceId",
                        label: "执行安排",
                        render: (r) => (
                          <div>
                            {r.deviceId ? deviceCaption(r.deviceId) : "等待编排"}
                            <small>
                              {String(
                                r.pilotName ||
                                  (r.pilotId ? pilotCaption(r.pilotId) : "待分配飞手"),
                              )}
                            </small>
                          </div>
                        ),
                      },
                      {
                        key: "status",
                        label: "当前阶段",
                        render: (r) => <Status status={r.status} />,
                      },
                      {
                        key: "next",
                        label: "下一步",
                        render: (r) => (
                          <span className="text-link">
                            {
                              taskNextStep(
                                r,
                                user.role,
                                plans.data?.items.find(
                                  (plan) => plan.id === r.planId,
                                ),
                              ).label
                            }{" "}
                            <ArrowRight size={12} />
                          </span>
                        ),
                      },
                    ]}
                    emptyTitle={
                      search || departmentFilter || resourceFilter
                        ? "没有匹配的任务"
                        : planId
                          ? "此计划尚未安排任务"
                          : "暂无任务"
                    }
                    emptyDescription={
                      planId
                        ? "返回原计划安排本次执行任务，或清除筛选查看其他任务。"
                        : "任务可由需求提报，也可从飞行服务中已审批的日常或长期计划安排。"
                    }
                  />
                </div>
                <TaskScheduleFooter
                  page={query.data}
                  visibleCount={filteredRows.length}
                  onChange={query.setPage}
                />
              </>
            )}
          </section>
        </div>
      )}
      {showCreate && (
        <Modal
          title={createPriority === "URGENT" ? "应急插单" : "提报飞行需求"}
          onClose={() => {
            if (!creationBusy.current) {
              setShowCreate(false);
              setCreatePriority("NORMAL");
            }
          }}
        >
          <TaskRequestForm
            fields={createFields}
            organizationId={user.organizationId}
            initialPriority={createPriority}
            onClose={() => {
              if (!creationBusy.current) {
                setShowCreate(false);
                setCreatePriority("NORMAL");
              }
            }}
            onBusyChange={(busy) => {
              creationBusy.current = busy;
            }}
          />
        </Modal>
      )}
      {editing && current && (
        <Modal title="编辑退回需求" onClose={() => setEditing(false)}>
          <EntityForm
            fields={createFields}
            initial={current}
            onCancel={() => setEditing(false)}
            submitLabel="保存修改"
            onSubmit={(body) =>
              mutate(
                () => write(`/tasks/${current.id}`, body, "PUT"),
                "需求修改已保存",
              )
            }
          />
        </Modal>
      )}
      {assistant && create && (
        <RequestAssistant
          organizations={organizations.data?.items || []}
          organizationsError={organizations.error}
          onClose={() => setAssistant(false)}
        />
      )}
      {selected && detail.error && (
        <Modal title="任务暂不可查看" onClose={() => setSelected(null)}>
          <Empty error={detail.error} />
        </Modal>
      )}
      {current && (
        <Modal
          title={entityName(current)}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="detail-heading">
            <span className="mono">{String(current.number || current.id)}</span>
            <Status status={current.status} />
          </div>
          <Details
            items={[
              { label: "作业目标", value: String(current.description || "—") },
              { label: "应用场景", value: String(current.scene || "—") },
              { label: "作业区域", value: current.region },
              {
                label: "期望时间",
                value: `${dateTime(current.startAt)} — ${dateTime(current.endAt)}`,
              },
              {
                label: "执行设备",
                value: deviceCaption(current.deviceId),
              },
              {
                label: "成果说明",
                value: String(current.resultSummary || "—"),
              },
            ]}
          />
          {(current.scene !== "资料核对" || !!current.planId) && (
            <section className="task-approval-strip" aria-label="飞行计划审批">
              <div>
                <small>关联飞行计划</small>
                <strong>
                  {currentPlan
                    ? entityName(currentPlan)
                    : current.planId
                      ? "计划资料加载中"
                      : "尚未关联飞行计划"}
                </strong>
                {currentPlan && <Status status={currentPlan.status} />}
                <p>
                  {currentPlanQuery.error
                    ? "关联计划暂不可读取，不能开始新的作业；请恢复后重试。"
                    : ![
                          "PENDING_ASSIGNMENT",
                          "PENDING_EXECUTION",
                          "EXECUTING",
                        ].includes(String(current.status))
                      ? "任务已结束办理，审批记录留存，设备作业按钮保持关闭。"
                      : currentPlanMatch && !currentPlanMatch.allowed
                        ? currentPlanMatch.reason
                        : currentPlan?.status === "APPROVED"
                          ? current.status === "PENDING_ASSIGNMENT"
                            ? "已批计划直接沿用，无需再次审批。下一步分配执行设备和飞手。"
                            : "计划已通过审批，无需再次审批；可进入设备运行页面核对并使用对应操作按钮。"
                          : "关联日常或长期计划，审批通过后解锁设备操作按钮。"}{" "}
                  当前按钮仅作页面交互。
                </p>
              </div>
              <div className="action-strip">
                {manage &&
                  ["PENDING_ASSIGNMENT", "PENDING_EXECUTION"].includes(
                    String(current.status),
                  ) && (
                    <Button onClick={() => setAction("LINK_PLAN")}>
                      {current.planId ? "更换关联计划" : "关联飞行计划"}
                    </Button>
                  )}
                {!!current.planId && (
                  <Button
                    onClick={() =>
                      navigate("services", {
                        planId: String(current.planId),
                        taskId: current.id,
                      })
                    }
                  >
                    {currentPlan?.status === "APPROVED"
                      ? "返回原计划"
                      : "查看 / 办理审批"}{" "}
                    <ArrowRight size={12} />
                  </Button>
                )}
              </div>
            </section>
          )}
          {nextStep && (
            <div className="task-next-step" role="note">
              <div>
                <small>下一步</small>
                <strong>{nextStep.label}</strong>
              </div>
              <p>{nextStep.detail}</p>
            </div>
          )}
          <div className="action-strip">
            {["DRAFT", "RETURNED"].includes(current.status || "") && create && (
              <>
                <Button onClick={() => setEditing(true)}>编辑需求</Button>
                <Button primary onClick={() => setAction("SUBMIT")}>
                  {current.status === "DRAFT" ? "提交需求" : "重新提交"}
                </Button>
              </>
            )}
            {current.status === "PENDING_ASSIGNMENT" && manage && (
              <Button primary onClick={() => setAction("ASSIGN")}>
                分配资源
              </Button>
            )}
            {current.status === "PENDING_EXECUTION" &&
              ["ADMIN", "DISPATCH", "PILOT"].includes(user.role) && (
                <Button
                  primary
                  disabled={!canStart}
                  title={startReason}
                  onClick={() => setAction("START")}
                >
                  登记开始执行
                </Button>
              )}
            {current.status === "EXECUTING" &&
              ["ADMIN", "DISPATCH", "PILOT"].includes(user.role) && (
                <Button primary onClick={() => setAction("FINISH")}>
                  提交成果
                </Button>
              )}
            {current.status === "PENDING_ACCEPTANCE" &&
              ["ADMIN", "DEPARTMENT"].includes(user.role) && (
                <Button primary onClick={() => setAction("ACCEPT")}>
                  验收通过
                </Button>
              )}
            {((current.status === "PENDING_ASSIGNMENT" && manage) ||
              (current.status === "PENDING_ACCEPTANCE" &&
                ["ADMIN", "DEPARTMENT"].includes(user.role))) && (
              <Button onClick={() => setAction("RETURN")}>退回完善</Button>
            )}
            {[
              "DRAFT",
              "RETURNED",
              "PENDING_ASSIGNMENT",
              "PENDING_EXECUTION",
            ].includes(current.status || "") &&
              (manage || user.role === "DEPARTMENT") && (
                <Button onClick={() => setAction("CANCEL")}>取消任务</Button>
              )}
            {["ADMIN", "DISPATCH", "PILOT"].includes(user.role) && (
              <Button
                title="先检查本任务审批、人员设备和执行时段，再确认进入飞控"
                onClick={() => navigate("flight", { taskId: current.id })}
              >
                飞控入口检查 <ArrowRight size={13} />
              </Button>
            )}
          </div>
          <Attachments
            taskId={current.id}
            readOnly={
              current.status === "COMPLETED" || current.status === "CANCELLED"
            }
          />
          <Provenance record={current} />
          <History path={`/tasks/${current.id}`} />
        </Modal>
      )}
      {current && action === "ASSIGN" && (
        <TaskAssignmentModal
          key={current.id}
          task={current}
          plans={flightPlanOptions}
          plansLoading={plans.isLoading}
          plansError={plans.error}
          currentPlanStatus={currentPlan?.status}
          navigate={navigate}
          onClose={() => setAction("")}
        />
      )}
      {current && action === "LINK_PLAN" && (
        <Modal title="关联飞行计划" onClose={() => setAction("")}>
          <div className="notice">
            只显示与任务同部门、同区域，且完整覆盖任务作业时段的日常或长期计划。已批计划直接沿用审批结果。
          </div>
          {plans.isLoading || plans.error || !flightPlanOptions.length ? (
            <>
              <Empty
                loading={plans.isLoading}
                error={plans.error}
                title="暂无匹配的飞行计划"
                description={`任务区域为${current.region || "未设置"}，作业时段为${dateTime(current.startAt)} — ${dateTime(current.endAt)}；请在飞行服务申请相同部门、区域并覆盖此时段的计划。`}
              />
              <Button
                onClick={() => navigate("services", { taskId: current.id })}
              >
                前往飞行服务
              </Button>
            </>
          ) : (
            <EntityForm
              fields={[
                {
                  key: "planId",
                  label: "关联飞行计划",
                  required: true,
                  options: flightPlanOptions,
                },
              ]}
              initial={{
                planId: flightPlanOptions.some(
                  (plan) => plan.value === current.planId,
                )
                  ? current.planId
                  : "",
              }}
              submitLabel="关联飞行计划"
              onCancel={() => setAction("")}
              onSubmit={(body) =>
                mutate(
                  () =>
                    write(`/tasks/${current.id}/actions`, {
                      ...body,
                      action: "LINK_PLAN",
                    }),
                  "已关联飞行计划",
                )
              }
            />
          )}
        </Modal>
      )}
      {current && action && !["ASSIGN", "LINK_PLAN"].includes(action) && (
        <ActionModal
          title={actionTitles[action]}
          path={`/tasks/${current.id}`}
          action={action}
          fields={
            action === "LINK_PLAN"
              ? [
                  {
                    key: "planId",
                    label: "关联飞行计划",
                    required: true,
                    options: flightPlanOptions,
                  },
                ]
              : action === "FINISH"
                ? [
                    {
                      key: "resultSummary",
                      label: "成果说明",
                      type: "textarea",
                      required: true,
                      wide: true,
                    },
                  ]
                : []
          }
          onClose={() => setAction("")}
          notice={
            action === "START"
              ? "登记本次作业已开始；不会向设备发送起飞指令。"
              : action === "LINK_PLAN"
                ? "关联日常或长期计划，审批通过后解锁对应设备的页面操作按钮；当前不发送设备指令。"
                : undefined
          }
        />
      )}
    </div>
  );
}
