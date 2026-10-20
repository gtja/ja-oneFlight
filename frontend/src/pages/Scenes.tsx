import { useState } from "react";
import { ArrowRight, Flame, MapPin, Plus } from "lucide-react";
import { entityName, useData, useList, write, type Entity } from "../api";
import { REGIONS, dateTime } from "../domain";
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
  Details,
  Empty,
  EntityForm,
  ListFooter,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Status,
} from "../components/UI";
const scenes = ["森林防火", "矿产监管", "非现执法"];
export default function Scenes() {
  const user = useUser();
  const canHandle = user.role !== "PILOT";
  const [scene, setScene] = useState("");
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState("");
  const query = useList("/cases", {
    scene,
    keyword: search,
    status: archived ? "ARCHIVED" : undefined,
    excludeStatus: archived ? undefined : "ARCHIVED",
  });
  const review = useList("/cases", {
    scene,
    status: "PENDING_REVIEW",
    pageSize: 1,
  });
  const disposal = useList("/cases", {
    scene,
    status: "PENDING_DISPOSAL",
    pageSize: 1,
  });
  const tasks = useList("/tasks");
  const mutate = useMutationFeedback();
  const rows = query.data?.items || [];
  const selectedId = selected?.id || rows[0]?.id;
  const detail = useData<Entity>(
    `/cases/${selectedId || "none"}`,
    !!selectedId,
  );
  const current = detail.data || selected || rows[0];
  return (
    <div className="page">
      <PageHeader title="场景应用" subtitle="现场线索、证据复核与处置跟踪">
        <Select
          label="工作内容"
          value={scene}
          onChange={(v) => {
            setScene(v);
            setSelected(null);
          }}
          options={[{ value: "", label: "全部" }, ...scenes]}
        />
        {canHandle && (
          <Button primary onClick={() => setCreate(true)}>
            <Plus size={14} />
            登记线索
          </Button>
        )}
      </PageHeader>
      <div className="split-workspace scene-workspace">
        <aside className="queue">
          <div className="scene-counts">
            <div>
              <strong>{review.data?.total ?? "—"}</strong>
              待复核
            </div>
            <div>
              <strong>{disposal.data?.total ?? "—"}</strong>
              待处置
            </div>
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="搜索线索、区域或案件号"
          />
          <Select
            label="事项状态"
            value={archived ? "archived" : "open"}
            onChange={(v) => {
              setArchived(v === "archived");
              setSelected(null);
            }}
            options={[
              { value: "open", label: "未结事项" },
              { value: "archived", label: "已归档" },
            ]}
          />
          <div className="queue-label">
            行业事项<span>{query.data?.total ?? "—"}</span>
          </div>
          {rows.map((r) => (
            <button
              key={r.id}
              className={`queue-card ${r.id === current?.id ? "selected" : ""}`}
              onClick={() => setSelected(r)}
            >
              <div>
                <Flame size={14} />
                <Status
                  status={r.status}
                  label={r.status === "PENDING_REVIEW" ? "待复核" : undefined}
                />
              </div>
              <strong>{entityName(r)}</strong>
              <small>
                <MapPin size={12} />
                {r.region}
              </small>
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
              title="暂无行业线索"
              description="人工登记或接通真实识别结果后进入复核。"
            />
          )}
          <ListFooter page={query.data} onChange={query.setPage} />
          <p className="footnote">飞行任务与行业处置分别跟踪</p>
        </aside>
        <main className="workspace-detail">
          {current ? (
            <>
              <div className="object-heading">
                <div>
                  <small>
                    {String(current.number || current.id)} / {current.region}
                  </small>
                  <h2>{entityName(current)}</h2>
                </div>
                <Status
                  status={current.status}
                  label={
                    current.status === "PENDING_REVIEW" ? "待复核" : undefined
                  }
                />
              </div>
              <div className="detail-columns">
                <div>
                  <section className="section">
                    <h3>证据研判</h3>
                    <Details
                      items={[
                        {
                          label: "线索说明",
                          value: String(current.description || "—"),
                        },
                        {
                          label: "关联任务",
                          value: entityName(
                            tasks.data?.items.find(
                              (t) => t.id === current.taskId,
                            ),
                          ),
                        },
                        {
                          label: "发现时间",
                          value: dateTime(current.createdAt),
                        },
                        {
                          label: "复核 / 处置结论",
                          value: String(current.conclusion || "尚未填写"),
                        },
                      ]}
                    />
                  </section>
                  <Attachments
                    caseId={current.id}
                    readOnly={current.status === "ARCHIVED"}
                  />
                  <Provenance record={current} />
                  <History path={`/cases/${current.id}`} />
                </div>
                <aside className="handling">
                  <h3>当前办理</h3>
                  <Status
                    status={current.status}
                    label={
                      current.status === "PENDING_REVIEW" ? "待复核" : undefined
                    }
                  />
                  <div className="case-steps">
                    {["复核", "处置", "归档"].map((label, i) => (
                      <div key={label}>
                        <span>{i + 1}</span>
                        {label}
                      </div>
                    ))}
                  </div>
                  <p className="muted">
                    结合现场材料确认线索，记录人工判断与处置结果。
                  </p>
                  {canHandle && (
                    <div className="handling-card">
                      {current.status === "PENDING_REVIEW" && (
                        <>
                          <Button primary onClick={() => setAction("VERIFY")}>
                            复核通过
                          </Button>
                          <Button onClick={() => setAction("DISMISS")}>
                            认定无效并归档
                          </Button>
                        </>
                      )}
                      {current.status === "PENDING_DISPOSAL" && (
                        <Button primary onClick={() => setAction("RESOLVE")}>
                          登记处置并归档
                        </Button>
                      )}
                      {current.status === "RESOLVED" && (
                        <Button primary onClick={() => setAction("ARCHIVE")}>
                          完成归档
                        </Button>
                      )}
                    </div>
                  )}
                </aside>
              </div>
            </>
          ) : (
            <Empty
              title="选择行业事项"
              description="现场证据、复核结论与处置记录将在这里显示。"
            />
          )}
        </main>
      </div>
      {create && (
        <Modal title={`登记${scene}线索`} onClose={() => setCreate(false)}>
          <EntityForm
            fields={[
              { key: "title", label: "线索名称", required: true, wide: true },
              {
                key: "scene",
                label: "场景",
                required: true,
                options: scenes.map((v) => ({ value: v, label: v })),
              },
              {
                key: "region",
                label: "所属区域",
                required: true,
                options: REGIONS.map((v) => ({ value: v, label: v })),
              },
              {
                key: "taskId",
                label: "来源任务",
                options: (tasks.data?.items || []).map((r) => ({
                  value: r.id,
                  label: entityName(r),
                })),
              },
              {
                key: "description",
                label: "线索说明",
                type: "textarea",
                required: true,
                wide: true,
              },
            ]}
            initial={{ scene }}
            onCancel={() => setCreate(false)}
            submitLabel="登记线索"
            onSubmit={(body) =>
              mutate(() => write("/cases", body), "行业线索已登记")
            }
          />
        </Modal>
      )}
      {current && action && (
        <ActionModal
          path={`/cases/${current.id}`}
          action={action}
          title={
            {
              VERIFY: "复核通过",
              DISMISS: "无效线索归档",
              RESOLVE: "登记处置并归档",
              ARCHIVE: "完成归档",
            }[action] || action
          }
          fields={[
            {
              key: "conclusion",
              label: "人工结论 / 处置结果",
              type: "textarea",
              required: true,
              wide: true,
            },
          ]}
          onClose={() => setAction("")}
        />
      )}
    </div>
  );
}
