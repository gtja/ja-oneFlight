import type { Entity } from "./api";

export type FlightPlanCompatibility = {
  allowed: boolean;
  code: string;
  reason: string;
};

const reject = (code: string, reason: string): FlightPlanCompatibility => ({
  allowed: false,
  code,
  reason,
});
const instant = (value: unknown) =>
  typeof value === "string" && value.trim() ? Date.parse(value) : NaN;

/** A plan covers many task occurrences; task.planId is the authoritative link. */
export function flightPlanCompatibility(
  task: Entity,
  plan: Entity,
): FlightPlanCompatibility {
  if (!["DAILY", "LONG_TERM"].includes(String(plan.kind)))
    return reject("INVALID_PLAN_KIND", "只能关联日常或长期飞行计划。");
  if (!task.organizationId || task.organizationId !== plan.organizationId)
    return reject(
      "PLAN_ORGANIZATION_MISMATCH",
      "任务与飞行计划须属于同一组织。",
    );
  if (!task.region || task.region !== plan.region)
    return reject(
      "PLAN_REGION_MISMATCH",
      "任务作业区域须与飞行计划适用区域一致。",
    );
  const taskStart = instant(task.startAt);
  const taskEnd = instant(task.endAt);
  const planStart = instant(plan.startAt);
  const planEnd = instant(plan.endAt);
  if (
    ![taskStart, taskEnd, planStart, planEnd].every(Number.isFinite) ||
    taskStart >= taskEnd ||
    planStart >= planEnd
  )
    return reject(
      "PLAN_TIME_INVALID",
      "任务或飞行计划的起止时间不完整或无效。",
    );
  if (taskStart < planStart || taskEnd > planEnd)
    return reject(
      "PLAN_TIME_MISMATCH",
      "任务作业时段须完整包含在飞行计划有效期内。",
    );
  return {
    allowed: true,
    code: "PLAN_COMPATIBLE",
    reason: "任务范围和时段符合关联飞行计划。",
  };
}
