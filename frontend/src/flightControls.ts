import type { CurrentUser, Entity } from "./api";
import { flightPlanCompatibility } from "./flightPlanLink";

export interface FlightControlContext {
  device?: Entity;
  resource?: Entity;
  task?: Entity;
  plan?: Entity;
  user: CurrentUser;
  loading?: boolean;
  error?: Error | null;
}

export type FlightControlGate = {
  enabled: boolean;
  code: string;
  reason: string;
};

const blocked = (code: string, reason: string): FlightControlGate => ({
  enabled: false,
  code,
  reason,
});
const idPresent = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** Mirrors the local organization and region scope; source telemetry is not a control prerequisite. */
function inScope(record: Entity, user: CurrentUser): boolean {
  if (user.role === "ADMIN") return true;
  const organizationAllowed =
    idPresent(record.organizationId) &&
    (record.organizationId === user.organizationId ||
      (user.role === "DISPATCH" &&
        (user.organizationIds || []).includes(record.organizationId)));
  return (
    organizationAllowed &&
    (!user.regions.length ||
      record.region == null ||
      user.regions.includes(record.region))
  );
}

/** Enables local page interactions only. This does not authorize or send a physical device command. */
export function getFlightControlGate({
  device,
  resource,
  task,
  plan,
  user,
  loading,
  error,
}: FlightControlContext): FlightControlGate {
  if (error)
    return blocked("LOAD_ERROR", "关联资料读取失败，请刷新后重新核对审批。");
  if (loading)
    return blocked("LOADING", "正在核对任务、设备与关联计划的审批状态。");
  if (!device || !idPresent(device.id))
    return blocked("NO_DEVICE", "请先选择任务分配的设备。");
  if (!task || !idPresent(task.id))
    return blocked("NO_TASK", "请从已分配的任务进入，核对该任务的审批结果。");
  if (
    !resource ||
    resource.kind !== "DEVICE" ||
    !idPresent(resource.id) ||
    !idPresent(resource.sourceDeviceId) ||
    !idPresent(task.deviceId) ||
    task.deviceId !== resource.id ||
    resource.sourceDeviceId !== device.id
  )
    return blocked(
      "DEVICE_MISMATCH",
      "当前设备与任务分配不一致，请返回任务核对。",
    );
  if (resource.status !== "ACTIVE")
    return blocked(
      "RESOURCE_UNAVAILABLE",
      "该设备尚未设为可调度，请先完善设备调度资料。",
    );
  if (!idPresent(task.pilotId))
    return blocked("NO_PILOT", "任务尚未分配执行飞手，请先完成资源分配。");
  if (!idPresent(task.planId))
    return blocked("NO_PLAN", "任务尚未关联飞行计划，请先关联并完成计划审批。");
  if (!plan || !idPresent(plan.id) || task.planId !== plan.id)
    return blocked(
      "PLAN_MISMATCH",
      "关联计划与当前任务不一致，请返回任务核对。",
    );
  if (plan.kind !== "DAILY" && plan.kind !== "LONG_TERM")
    return blocked("INVALID_PLAN_KIND", "请关联已审批的日常计划或长期计划。");
  if (plan.status !== "APPROVED")
    return blocked(
      "APPROVAL_REQUIRED",
      "关联飞行计划尚未审批通过，通过后解锁作业按钮。",
    );
  if (!["PENDING_EXECUTION", "EXECUTING"].includes(task.status || ""))
    return blocked(
      "TASK_NOT_EXECUTABLE",
      "任务当前不在待执行或执行中阶段，作业按钮已锁定。",
    );
  if (
    user.role !== "ADMIN" &&
    user.role !== "DISPATCH" &&
    !(user.role === "PILOT" && task.pilotId === user.id)
  )
    return blocked(
      "ROLE_FORBIDDEN",
      "仅管理员、运营调度或本任务的执行飞手可操作。",
    );
  if (![resource, task, plan].every((record) => inScope(record, user)))
    return blocked(
      "SCOPE_FORBIDDEN",
      "当前任务、计划或设备不在你的组织及区域权限内。",
    );
  if (
    user.role !== "ADMIN" &&
    !user.deviceIds.includes(resource.id) &&
    !user.deviceIds.includes(resource.sourceDeviceId)
  )
    return blocked("DEVICE_FORBIDDEN", "当前账号尚未获得这台设备的使用权限。");
  const compatibility = flightPlanCompatibility(task, plan);
  if (!compatibility.allowed)
    return blocked(compatibility.code, compatibility.reason);
  return {
    enabled: true,
    code: "APPROVED",
    reason: "关联飞行计划已审批通过，当前任务的作业按钮已解锁。",
  };
}
