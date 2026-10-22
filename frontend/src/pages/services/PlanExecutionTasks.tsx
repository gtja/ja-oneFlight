import { ArrowRight } from "lucide-react";
import {
  entityName,
  type CurrentUser,
  type Entity,
  type Page,
} from "../../api";
import { dateTime } from "../../domain";
import type { Navigate } from "../../navigation";
import { Button, DataTable, ListFooter, Status } from "../../components/UI";

export default function PlanExecutionTasks({
  plan,
  tasks,
  loading,
  error,
  resources,
  role,
  arrange,
  navigate,
  onPageChange,
}: {
  plan: Entity;
  tasks?: Page;
  loading: boolean;
  error: Error | null;
  resources: Entity[];
  role: CurrentUser["role"];
  arrange: boolean;
  navigate?: Navigate;
  onPageChange: (page: number) => void;
}) {
  return (
    <section
      className="section plan-execution-tasks"
      data-testid="plan-execution-tasks"
      aria-label="计划关联执行任务"
    >
      <div className="section-title">
        <div>
          <h3>执行任务</h3>
          <span>
            已关联 {tasks?.total ?? "—"} 条 · 每条任务独立分配、执行和验收
          </span>
        </div>
        <div className="action-strip">
          {navigate && (
            <Button
              small
              onClick={() => navigate("dispatch", { planId: plan.id })}
            >
              查看全部任务 <ArrowRight size={12} />
            </Button>
          )}
        </div>
      </div>
      <p className="plan-execution-note">
        {plan.status === "APPROVED"
          ? "计划已审批通过，安排的任务直接进入待分配，沿用审批结果。长期计划可按实际作业需要安排多次任务。"
          : "审核通过后即可在此安排执行任务；已有任务保留办理记录，未通过审批时不能开始新的飞行作业。"}
      </p>
      <DataTable
        rows={tasks?.items || []}
        loading={loading}
        error={error}
        emptyTitle="尚未安排执行任务"
        emptyDescription={
          plan.status === "APPROVED" && arrange
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
                <small>{String(task.number || task.id)}</small>
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
            render: (task) => {
              if (!task.deviceId) return "待分配";
              const resource = resources.find(
                (item) => item.id === task.deviceId,
              );
              return resource ? entityName(resource) : "设备档案不可见";
            },
          },
          {
            key: "status",
            label: "任务阶段",
            render: (task) => <Status status={task.status} />,
          },
          {
            key: "operation",
            label: "操作",
            render: (task) =>
              navigate && (
                <div className="flight-entry-actions">
                  <Button
                    small
                    onClick={() =>
                      navigate("dispatch", {
                        taskId: task.id,
                        planId: plan.id,
                      })
                    }
                  >
                    查看任务 <ArrowRight size={12} />
                  </Button>
                  {["ADMIN", "DISPATCH", "PILOT"].includes(role) && (
                    <Button
                      small
                      onClick={() =>
                        navigate("flight", {
                          taskId: task.id,
                        })
                      }
                    >
                      飞控入口检查 <ArrowRight size={12} />
                    </Button>
                  )}
                </div>
              ),
          },
        ]}
      />
      <ListFooter page={tasks} onChange={onPageChange} />
    </section>
  );
}
