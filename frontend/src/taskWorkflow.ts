import type { CurrentUser, Entity } from "./api";
import { flightPlanCompatibility } from "./flightPlanLink";

export function taskNextStep(
  task: Entity,
  role: CurrentUser["role"],
  plan?: Entity,
) {
  const manage = role === "ADMIN" || role === "DISPATCH";
  const demand = role === "ADMIN" || role === "DEPARTMENT";
  switch (task.status) {
    case "DRAFT":
      return {
        label: "提交需求",
        detail: "补齐作业区域、时间与要求后提交，由运营调度分配资源。",
      };
    case "RETURNED":
      return {
        label: "修改并重新提交",
        detail: "按办理履历中的退回意见完善需求，再提交给运营调度。",
      };
    case "PENDING_ASSIGNMENT":
      return {
        label: manage ? "分配设备和飞手" : "等待调度分配",
        detail:
          plan?.status === "APPROVED"
            ? "本任务沿用已通过的飞行计划，运营调度分配设备和飞手后即可准备执行，无需重复审批。"
            : "运营调度选择可调度设备和有权限的飞手，关联适用的飞行计划并完成审批。",
      };
    case "PENDING_EXECUTION":
      if (task.scene !== "资料核对" || task.planId) {
        if (!task.planId)
          return {
            label: manage ? "关联飞行计划" : "等待关联计划",
            detail:
              "在本任务关联日常或长期飞行计划，审批通过后解锁设备操作按钮。",
          };
        if (!plan)
          return {
            label: "核对计划资料",
            detail:
              "正在读取关联计划；资料不可用时，请核对访问权限后重新加载。",
          };
        const compatibility = flightPlanCompatibility(task, plan);
        if (!compatibility.allowed)
          return { label: "核对计划范围", detail: compatibility.reason };
        if (plan.status !== "APPROVED")
          return {
            label: manage ? "办理计划审批" : "等待计划审批",
            detail: "查看关联计划的审批进度，通过后进入设备运行页面。",
          };
        return {
          label: manage || role === "PILOT" ? "进入飞行管控" : "等待执行",
          detail:
            "飞行计划已审批通过，可进入本任务设备使用页面操作按钮；当前不发送设备指令。",
        };
      }
      return {
        label: manage || role === "PILOT" ? "登记开始执行" : "等待执行",
        detail:
          "执行人员开始工作后登记业务进度。此操作不会向设备发送起飞指令。",
      };
    case "EXECUTING":
      return {
        label: manage || role === "PILOT" ? "上传成果并提交" : "等待提交成果",
        detail: "补充成果说明和附件，提交给需求部门验收。设备观测可随时查看。",
      };
    case "PENDING_ACCEPTANCE":
      return {
        label: demand ? "核对成果并验收" : "等待需求部门验收",
        detail:
          "需求部门查看成果与附件，通过后完成任务；需补充时退回执行人员。",
      };
    case "COMPLETED":
      return {
        label: "查看成果",
        detail: "任务已完成，成果文件与办理履历持续保留。",
      };
    case "CANCELLED":
      return {
        label: "查看取消说明",
        detail: "任务已取消，取消原因保存在办理履历中。",
      };
    default:
      return { label: "查看任务", detail: "查看任务当前状态与办理履历。" };
  }
}
