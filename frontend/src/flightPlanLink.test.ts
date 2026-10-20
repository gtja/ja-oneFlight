import { describe, expect, it } from "vitest";
import type { Entity } from "./api";
import { flightPlanCompatibility } from "./flightPlanLink";

const task = (): Entity => ({
  id: "task-2",
  organizationId: "org-1",
  region: "余杭区",
  startAt: "2026-10-16T01:00:00Z",
  endAt: "2026-10-16T02:00:00Z",
});
const plan = (): Entity => ({
  id: "plan-1",
  kind: "LONG_TERM",
  organizationId: "org-1",
  region: "余杭区",
  startAt: "2026-10-16T00:00:00Z",
  endAt: "2026-10-23T10:00:00Z",
  taskId: "task-1",
});

describe("执行任务与飞行计划的范围", () => {
  it("一个长期计划允许多个任务，不用兼容主任务字段排斥其他任务", () => {
    expect(flightPlanCompatibility(task(), plan()).allowed).toBe(true);
    expect(
      flightPlanCompatibility({ ...task(), id: "task-3" }, plan()).allowed,
    ).toBe(true);
  });
  it("完整覆盖的边界和不同时区表示按同一时间比较", () => {
    expect(
      flightPlanCompatibility(
        {
          ...task(),
          startAt: "2026-10-16T08:00:00+08:00",
          endAt: "2026-10-23T18:00:00+08:00",
        },
        plan(),
      ).allowed,
    ).toBe(true);
  });
  it.each([
    ["organizationId", "other-org", "PLAN_ORGANIZATION_MISMATCH"],
    ["region", "西湖区", "PLAN_REGION_MISMATCH"],
    ["startAt", "2026-10-15T23:59:59Z", "PLAN_TIME_MISMATCH"],
    ["endAt", "2026-10-23T10:00:01Z", "PLAN_TIME_MISMATCH"],
    ["startAt", "invalid", "PLAN_TIME_INVALID"],
    ["endAt", undefined, "PLAN_TIME_INVALID"],
    ["endAt", "2026-10-16T01:00:00Z", "PLAN_TIME_INVALID"],
  ])("任务%s不满足时不允许关联", (field, value, code) => {
    expect(
      flightPlanCompatibility({ ...task(), [field]: value }, plan()).code,
    ).toBe(code);
  });
  it("准入审批和计划自身无效时段不作飞行作业依据", () => {
    expect(
      flightPlanCompatibility(task(), { ...plan(), kind: "DEVICE_ADMISSION" })
        .code,
    ).toBe("INVALID_PLAN_KIND");
    expect(
      flightPlanCompatibility(task(), {
        ...plan(),
        endAt: "2026-10-15T00:00:00Z",
      }).code,
    ).toBe("PLAN_TIME_INVALID");
  });
});
