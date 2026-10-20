import type { Entity } from "./api";
import { flightPlanCompatibility } from "./flightPlanLink";

export type PlanTaskInput = {
  title: string;
  scene: string;
  description: string;
  priority: string;
  startAt: string;
  endAt: string;
  requestId: string;
};

export function planTaskRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/** A long term plan authorizes a time range; each task is one occurrence. */
export function defaultPlanTaskWindow(plan: Entity, now = Date.now()) {
  const first = Date.parse(String(plan.startAt || ""));
  const last = Date.parse(String(plan.endAt || ""));
  if (!Number.isFinite(first) || !Number.isFinite(last) || first >= last)
    return { startAt: "", endAt: "" };
  const minute = 60_000;
  const nextMinute = Math.ceil(now / minute) * minute;
  const start = nextMinute >= last ? first : Math.max(first, nextMinute);
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(Math.min(start + 3_600_000, last)).toISOString(),
  };
}

export function planTaskValidation(plan: Entity, input: PlanTaskInput) {
  if (plan.status !== "APPROVED") return "计划尚未审批通过，不能安排执行任务。";
  if (!input.title.trim()) return "请填写任务名称。";
  if (input.title.length > 180) return "任务名称不能超过180个字符。";
  if (!input.scene.trim()) return "请选择应用场景。";
  if (!input.description.trim()) return "请填写作业要求。";
  const match = flightPlanCompatibility(
    {
      id: "new-task",
      organizationId: plan.organizationId,
      region: plan.region,
      startAt: input.startAt,
      endAt: input.endAt,
    },
    plan,
  );
  return match.allowed ? "" : match.reason;
}
