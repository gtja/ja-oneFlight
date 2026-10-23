import { useLayoutEffect, useRef, useState } from "react";
import "./experience.css";
import { ArrowRight, Boxes, BrainCircuit, Cpu } from "lucide-react";
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
  Tabs,
} from "../components/UI";
import { deploymentLabel } from "./algorithms/deploymentStatus";
import "./algorithms/algorithms.css";
export default function Algorithms() {
  const user = useUser();
  const [tab, setTab] = useState("catalog");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const categories = useData<
    { key: string; name: string; count: number | null }[]
  >("/algorithms/categories", tab === "catalog");
  const [deployed, setDeployed] = useState("");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  useLayoutEffect(() => {
    if (workspace.current)
      workspace.current.scrollTop = detailOpen ? 0 : listScroll.current;
  }, [detailOpen]);
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
    all: number | null;
    deployed: number | null;
    undeployed: number | null;
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
  const tasks = useList(
    "/tasks",
    {},
    tab === "review" && reviewSource === "task",
  );
  const detections = useList(
    `/tasks/${taskId || "none"}/detections`,
    {},
    tab === "review" && reviewSource === "task" && !!taskId,
  );
  return (
    <div className="page algorithm-page experience-page">
      <PageHeader
        title="飞行算法"
        subtitle="查询算法目录与部署登记，查看识别记录并登记样本准备事项"
      >
        <small>算法目录与部署状态来自真实来源</small>
      </PageHeader>
      <nav className="algorithm-navigation" aria-label="算法工作区">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "catalog", label: "算法目录" },
            { id: "review", label: "识别记录" },
            { id: "training", label: "样本与训练登记" },
          ]}
        />
      </nav>
      {tab === "catalog" ? (
        <>
          <div className="algorithm-stats" aria-busy={statistics.isLoading}>
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
          </div>
          {statistics.isLoading && (
            <p className="algorithm-query-note" role="status">
              正在读取算法统计…
            </p>
          )}
          {statistics.error && (
            <div className="algorithm-query-note" role="alert">
              统计暂不可用：{statistics.error.message}
              <Button small onClick={() => void statistics.refetch()}>
                重试统计
              </Button>
            </div>
          )}
          <div
            ref={workspace}
            className={`algorithm-workspace ${detailOpen ? "detail-open" : ""}`}
          >
            <aside className="algorithm-list">
              <SearchBox
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setDetailOpen(false);
                }}
                placeholder="搜索算法名称或能力"
              />
              <Select
                label="算法分类"
                value={category}
                disabled={categories.isLoading}
                onChange={(value) => {
                  setCategory(value);
                  setDetailOpen(false);
                }}
                options={[
                  { value: "", label: "全部分类" },
                  ...(categories.data || []).map((c) => ({
                    value: c.key,
                    label: c.name,
                  })),
                  ...(category &&
                  !categories.data?.some((item) => item.key === category)
                    ? [{ value: category, label: category }]
                    : []),
                ]}
              />
              {categories.error && (
                <p className="algorithm-query-note" role="alert">
                  分类读取失败
                  <Button small onClick={() => void categories.refetch()}>
                    重试分类
                  </Button>
                </p>
              )}
              <Select
                label="部署筛选"
                value={deployed}
                onChange={(value) => {
                  setDeployed(value);
                  setDetailOpen(false);
                }}
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
                  aria-pressed={current?.id === r.id}
                  onClick={() => {
                    listScroll.current = workspace.current?.scrollTop || 0;
                    setSelected(r);
                    setDetailOpen(true);
                  }}
                >
                  <div>
                    <strong>{entityName(r)}</strong>
                    <p>{String(r.description || "暂无算法说明")}</p>
                    <small>
                      {String(r.version || "版本待核对")} ·{" "}
                      {deploymentLabel(r.deployed)}
                    </small>
                    <small className="algorithm-category">
                      {(r.categories as string[] | undefined)?.join(" / ") ||
                        "分类待核对"}
                    </small>
                  </div>
                </button>
              ))}
              {!rows.length && (
                <Empty
                  loading={list.isLoading}
                  error={list.error}
                  title={
                    search || category || deployed
                      ? "当前筛选下暂无算法"
                      : "暂无算法"
                  }
                  description="算法目录按真实来源展示，可调整筛选条件后重试。"
                />
              )}
              {list.error ? (
                <Button onClick={() => void list.refetch()}>
                  重新读取目录
                </Button>
              ) : !rows.length &&
                !list.isLoading &&
                (search || category || deployed) ? (
                <Button
                  onClick={() => {
                    setSearch("");
                    setCategory("");
                    setDeployed("");
                  }}
                >
                  清空筛选
                </Button>
              ) : null}
              <ListFooter page={list.data} onChange={list.setPage} />
            </aside>
            <main className="algorithm-detail">
              <Button
                className="algorithm-back"
                small
                onClick={() => setDetailOpen(false)}
              >
                返回算法目录
              </Button>
              {list.isLoading || list.error ? (
                <Empty
                  loading={list.isLoading}
                  error={list.error}
                  description="正在读取算法目录…"
                />
              ) : current ? (
                <>
                  <div className="algorithm-hero">
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
                        value: deploymentLabel(current.deployed),
                      },
                    ]}
                  />
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
                  </section>
                  <details className="algorithm-capability-note">
                    <summary>能力说明</summary>
                    <p>
                      当前可查询来源算法和部署登记；部署、停用及计算训练尚未接通。样本与训练准备事项可在“样本与训练登记”中维护。
                    </p>
                  </details>
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
              <h2>识别记录</h2>
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
          {reviewSource === "task" && tasks.error && (
            <div className="algorithm-query-note" role="alert">
              任务读取失败：{tasks.error.message}
              <Button small onClick={() => void tasks.refetch()}>
                重试任务
              </Button>
            </div>
          )}
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
              loading={tasks.isLoading}
              description="选择关联任务查看识别记录，来源未接通时会显示具体原因。"
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
              <h2>样本与训练登记</h2>
              <p>样本收集、标注准备与训练事项统一登记</p>
            </div>
            {manage && (
              <Button primary onClick={() => setCreateWork(true)}>
                登记
                {trainingKind === "ALGORITHM_DATASET" ? "样本集合" : "训练事项"}
              </Button>
            )}
          </div>
          <div
            className="segmented algorithm-training-tabs"
            role="group"
            aria-label="登记类型"
          >
            <button
              className={trainingKind === "ALGORITHM_DATASET" ? "active" : ""}
              aria-pressed={trainingKind === "ALGORITHM_DATASET"}
              onClick={() => setTrainingKind("ALGORITHM_DATASET")}
            >
              样本集合
            </button>
            <button
              className={trainingKind === "ALGORITHM_TRAINING" ? "active" : ""}
              aria-pressed={trainingKind === "ALGORITHM_TRAINING"}
              onClick={() => setTrainingKind("ALGORITHM_TRAINING")}
            >
              训练事项
            </button>
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
          <p className="footnote">
            此处登记样本与训练准备事项，不执行计算训练、评测或模型发布。
          </p>
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
            <p className="footnote">此记录为训练准备事项，尚未提交计算训练。</p>
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
