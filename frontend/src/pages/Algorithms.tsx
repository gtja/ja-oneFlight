import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Database,
  FlaskConical,
  Layers3,
} from "lucide-react";
import {
  entityName,
  queryString,
  useData,
  useList,
  write,
  type Entity,
} from "../api";
import SourceRecords from "../components/SourceRecords";
import { Provenance, useMutationFeedback } from "../components/Workflow";
import { useUser } from "../context";
import { dateTime } from "../domain";
import {
  Button,
  EntityForm,
  DataTable,
  Details,
  Empty,
  ListFooter,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Status,
  Unavailable,
} from "../components/UI";
export default function Algorithms() {
  const user = useUser();
  const [tab, setTab] = useState("catalog");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const categories = useData<{ key: string; name: string; count: number }[]>(
    "/algorithms/categories",
  );
  const [deployed, setDeployed] = useState("");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [reviewSource, setReviewSource] = useState(
    ["ADMIN", "DISPATCH"].includes(user.role) ? "source" : "task",
  );
  const [trainingKind, setTrainingKind] = useState("ALGORITHM_DATASET");
  const [workSelected, setWorkSelected] = useState<Entity | null>(null);
  const [createWork, setCreateWork] = useState(false);
  const manage = ["ADMIN", "DISPATCH"].includes(user.role);
  const mutate = useMutationFeedback();
  const work = useList(
    "/resources",
    { kind: trainingKind },
    tab === "training",
  );

  const list = useList(
    "/algorithms",
    {
      keyword: search,
      category,
      deployment:
        deployed === "true"
          ? "deployed"
          : deployed === "false"
            ? "undeployed"
            : "all",
    },
    tab === "catalog",
  );
  const statistics = useData<{
    all: number;
    deployed: number;
    undeployed: number;
  }>(
    `/algorithms/statistics?${queryString({ keyword: search, category })}`,
    tab === "catalog",
  );
  const rows = list.data?.items || [];
  const current = selected
    ? rows.find((r) => r.id === selected.id) || rows[0]
    : rows[0];
  const deployments = useList(
    `/algorithms/${current?.id || "none"}/devices`,
    {},
    showDevices && !!current,
  );
  const tasks = useList("/tasks", {}, tab === "review");
  const detections = useList(
    `/tasks/${taskId || "none"}/detections`,
    {},
    tab === "review" && !!taskId,
  );
  return (
    <div className="page">
      <PageHeader
        title="飞行算法"
        subtitle="把识别能力连接到具体任务，让每个结果可复核、可追溯"
      >
        <Select
          label="工作内容"
          value={tab}
          onChange={setTab}
          options={[
            { value: "catalog", label: "算法目录" },
            { value: "review", label: "识别复核" },
            { value: "training", label: "样本训练" },
          ]}
        />
        <small>算法目录与部署状态来自真实来源</small>
      </PageHeader>
      {tab === "catalog" ? (
        <>
          <div className="algorithm-stats">
            <div>
              <BrainCircuit size={17} />
              <span>可选算法</span>
              <strong>{statistics.data?.all ?? "—"}</strong>
            </div>
            <div>
              <Cpu size={17} />
              <span>已部署算法</span>
              <strong>{statistics.data?.deployed ?? "—"}</strong>
            </div>
            <div>
              <Boxes size={17} />
              <span>未部署算法</span>
              <strong>{statistics.data?.undeployed ?? "—"}</strong>
            </div>
            <button onClick={() => setTab("review")}>
              <CheckCircle2 size={16} />
              进入识别复核 <ArrowRight size={12} />
            </button>
          </div>
          <div className="algorithm-workspace">
            <aside className="algorithm-list">
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="搜索算法名称或能力"
              />
              <Select
                label="算法分类"
                value={category}
                onChange={setCategory}
                options={[
                  { value: "", label: "全部分类" },
                  ...(categories.data || []).map((c) => ({
                    value: c.key,
                    label: c.name,
                  })),
                ]}
              />
              <Select
                label="部署筛选"
                value={deployed}
                onChange={setDeployed}
                options={[
                  { value: "", label: "全部算法" },
                  { value: "true", label: "已部署" },
                  { value: "false", label: "未部署" },
                ]}
              />
              {rows.map((r) => (
                <button
                  className={`algorithm-card ${current?.id === r.id ? "selected" : ""}`}
                  key={r.id}
                  onClick={() => setSelected(r)}
                >
                  <div className="algorithm-cover">
                    <BrainCircuit size={38} />
                    <span>
                      {String(
                        (r.categories as string[] | undefined)?.[0] ||
                          "算法能力",
                      )}
                    </span>
                  </div>
                  <div>
                    <strong>{entityName(r)}</strong>
                    <p>{String(r.description || "暂无算法说明")}</p>
                    <small>
                      {String(r.version || "版本待核对")} ·{" "}
                      {r.deployed ? "已部署" : "未部署"}
                    </small>
                  </div>
                </button>
              ))}
              {!rows.length && (
                <Empty
                  loading={list.isLoading}
                  error={list.error}
                  title="暂无算法"
                  description="算法仓配置完成后展示真实目录。"
                />
              )}
              <ListFooter page={list.data} onChange={list.setPage} />
            </aside>
            <main className="algorithm-detail">
              {current ? (
                <>
                  <div className="algorithm-hero">
                    <div className="algorithm-visual">
                      <BrainCircuit size={64} />
                      <div className="circuit-orbit" />
                    </div>
                    <div>
                      <small>
                        {String(
                          (current.categories as string[] | undefined)?.join(
                            " / ",
                          ) || "算法能力",
                        )}
                      </small>
                      <h2>{entityName(current)}</h2>
                      <span className="mono">{current.id}</span>
                      <p>{String(current.description || "暂无算法说明")}</p>
                      <Button disabled title="真实部署写接口尚未接通">
                        部署算法
                      </Button>
                    </div>
                  </div>
                  <Details
                    items={[
                      {
                        label: "模型名称",
                        value: String(current.modelName || "—"),
                      },
                      {
                        label: "当前版本",
                        value: String(current.version || "未知"),
                      },
                      {
                        label: "设备类型",
                        value: String(
                          (current.deviceTypes as string[] | undefined)?.join(
                            " / ",
                          ) || "待核对",
                        ),
                      },
                      {
                        label: "部署状态",
                        value: current.deployed ? "已部署" : "未部署",
                      },
                    ]}
                  />
                  <div className="algorithm-flow">
                    <span>
                      <Database size={16} />
                      模型版本
                    </span>
                    <ArrowRight size={14} />
                    <button onClick={() => setShowDevices(true)}>
                      <Cpu size={16} />
                      部署设备
                    </button>
                    <ArrowRight size={14} />
                    <button onClick={() => setTab("review")}>
                      <CheckCircle2 size={16} />
                      识别复核
                    </button>
                  </div>
                  <section className="section">
                    <div className="section-title">
                      <h3>部署与运行</h3>
                      <Button small onClick={() => setShowDevices(true)}>
                        查看部署设备 <ArrowRight size={12} />
                      </Button>
                    </div>
                    <p className="muted">
                      来源部署信息独立展示，部署登记状态不代表当前推理运行状态。
                    </p>
                    <Unavailable
                      title="部署、停用与训练接口未接通"
                      description="保留管理入口，实际写操作在来源契约和验证环境确定后启用。"
                    />
                  </section>
                  <section className="section">
                    <h3>运行结果</h3>
                    <p className="muted">
                      按任务查看已接通的识别记录，保留原图引用和模型版本。
                    </p>
                    <Button onClick={() => setTab("review")}>
                      查看识别记录 <ArrowRight size={12} />
                    </Button>
                  </section>
                </>
              ) : (
                <Empty
                  title="选择算法档案"
                  description="模型版本、能力说明与部署设备将在这里展示。"
                />
              )}
            </main>
          </div>
        </>
      ) : tab === "review" ? (
        <div className="content-pad">
          <div className="table-toolbar">
            <div>
              <h2>识别记录与人工复核</h2>
              <p>来源观测与本地关联结果分别查看，识别结论需人工核实</p>
            </div>
            <Select
              value={reviewSource}
              onChange={setReviewSource}
              label="识别记录来源"
              options={[
                ...(manage ? [{ value: "source", label: "来源识别记录" }] : []),
                { value: "task", label: "本地任务关联" },
              ]}
            />
            {reviewSource === "task" && (
              <Select
                value={taskId}
                onChange={setTaskId}
                label="来源任务"
                options={[
                  { value: "", label: "选择关联任务" },
                  ...(tasks.data?.items || []).map((r) => ({
                    value: r.id,
                    label: entityName(r),
                  })),
                ]}
              />
            )}
          </div>
          {reviewSource === "source" ? (
            <SourceRecords kind="events" />
          ) : taskId ? (
            <DataTable
              rows={detections.data?.items || []}
              error={detections.error}
              loading={detections.isLoading}
              columns={[
                { key: "id", label: "识别编号" },
                { key: "model", label: "模型 / 版本" },
                {
                  key: "status",
                  label: "来源状态",
                  render: (r) => <Status status={r.status} />,
                },
              ]}
            />
          ) : (
            <Empty
              title="选择关联任务"
              description="接通真实识别结果来源后，可查看并进入人工复核。"
            />
          )}
          <p className="footnote">
            来源识别记录保留原始时间、设备和类型；需要办理的事项在场景应用中登记并复核。
          </p>
        </div>
      ) : (
        <div className="content-pad">
          <div className="table-toolbar">
            <div>
              <h2>样本与训练</h2>
              <p>样本收集、标注准备与训练事项统一登记</p>
            </div>
            {manage && (
              <Button primary onClick={() => setCreateWork(true)}>
                登记
                {trainingKind === "ALGORITHM_DATASET" ? "样本集合" : "训练事项"}
              </Button>
            )}
          </div>
          <div className="training-grid">
            <section className="panel section">
              <Database size={30} />
              <h3>样本管理</h3>
              <p className="muted">收集来源观测，逐条核对标注</p>
              <Button onClick={() => setTrainingKind("ALGORITHM_DATASET")}>
                查看样本集合
              </Button>
            </section>
            <section className="panel section">
              <FlaskConical size={30} />
              <h3>训练任务</h3>
              <p className="muted">登记训练目标、数据准备及待接入事项</p>
              <Button onClick={() => setTrainingKind("ALGORITHM_TRAINING")}>
                查看训练事项
              </Button>
            </section>
            <section className="panel section">
              <Layers3 size={30} />
              <h3>模型版本</h3>
              <p className="muted">来源算法目录中的真实模型版本</p>
              <Button onClick={() => setTab("catalog")}>查看模型版本</Button>
            </section>
          </div>
          <section className="section">
            <h3>
              {trainingKind === "ALGORITHM_DATASET" ? "样本集合" : "训练事项"}
            </h3>
            <DataTable
              rows={work.data?.items || []}
              loading={work.isLoading}
              error={work.error}
              onRow={setWorkSelected}
              columns={[
                { key: "title", label: "名称", render: entityName },
                {
                  key: "description",
                  label: "内容",
                  render: (r) =>
                    String(
                      (r.metadata as Record<string, unknown>)?.description ||
                        "—",
                    ),
                },
                {
                  key: "status",
                  label: "状态",
                  render: (r) => <Status status={r.status} />,
                },
                {
                  key: "createdAt",
                  label: "登记时间",
                  render: (r) => dateTime(r.createdAt),
                },
              ]}
            />
            <ListFooter page={work.data} onChange={work.setPage} />
          </section>
          <Unavailable
            title="训练计算服务待接入"
            description="可登记样本与训练准备事项；接通计算服务后启用提交训练、评测及模型发布。"
          />
        </div>
      )}
      {workSelected && (
        <Modal
          title={entityName(workSelected)}
          onClose={() => setWorkSelected(null)}
        >
          <Status status={workSelected.status} />
          <Details
            items={Object.entries(
              (workSelected.metadata || {}) as Record<string, unknown>,
            )
              .filter(([key]) => key !== "provenance")
              .map(([key, val]) => ({
                label:
                  (
                    {
                      description: "内容说明",
                      algorithmId: "关联算法",
                      sourceEventId: "来源观测编号",
                      sampleCount: "已核验样本数量",
                      labelState: "标注状态",
                      trainingProvider: "训练服务",
                    } as Record<string, string>
                  )[key] || key,
                value:
                  val == null
                    ? "待核验"
                    : val === "UNLABELED"
                      ? "待标注"
                      : val === "NOT_CONFIGURED"
                        ? "待接入"
                        : typeof val === "object"
                          ? JSON.stringify(val)
                          : String(val),
              }))}
          />
          <Provenance record={workSelected} />
          {workSelected.kind === "ALGORITHM_TRAINING" && (
            <Button disabled title="训练计算服务未接通">
              提交训练
            </Button>
          )}
        </Modal>
      )}
      {createWork && (
        <Modal
          title={
            trainingKind === "ALGORITHM_DATASET"
              ? "登记样本集合"
              : "登记训练事项"
          }
          onClose={() => setCreateWork(false)}
        >
          <EntityForm
            fields={[
              { key: "title", label: "名称", required: true, wide: true },
              { key: "region", label: "区域", required: true },
              {
                key: "description",
                label: "内容说明",
                type: "textarea",
                required: true,
                wide: true,
              },
              { key: "algorithmId", label: "关联算法编号" },
            ]}
            initial={{ region: "杭州市" }}
            onCancel={() => setCreateWork(false)}
            onSubmit={(body) =>
              mutate(
                () =>
                  write("/resources", {
                    title: body.title,
                    region: body.region,
                    organizationId: user.organizationId,
                    kind: trainingKind,
                    status:
                      trainingKind === "ALGORITHM_DATASET"
                        ? "PENDING_LABELING"
                        : "PENDING_CONFIGURATION",
                    metadata: {
                      description: body.description,
                      algorithmId: body.algorithmId,
                      labelState: "UNLABELED",
                      trainingProvider: "NOT_CONFIGURED",
                      sampleCount: null,
                    },
                  }),
                "已登记",
              )
            }
          />
        </Modal>
      )}
      {showDevices && current && (
        <Modal
          title={`${entityName(current)} · 部署设备`}
          onClose={() => setShowDevices(false)}
          wide
        >
          <DataTable
            rows={deployments.data?.items || []}
            error={deployments.error}
            loading={deployments.isLoading}
            columns={[
              { key: "name", label: "部署设备", render: (r) => entityName(r) },
              { key: "deviceId", label: "来源设备编号" },
              { key: "deviceType", label: "设备类型" },
              { key: "status", label: "部署状态" },
            ]}
          />
          <ListFooter page={deployments.data} onChange={deployments.setPage} />
        </Modal>
      )}
    </div>
  );
}
