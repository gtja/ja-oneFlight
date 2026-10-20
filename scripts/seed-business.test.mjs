import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTaskPlan } from "./seed-business.mjs";

const task = {
  scene: "森林防火",
  organizationId: "org-1",
  region: "余杭区",
  startAt: "2026-10-18T01:00:00Z",
  endAt: "2026-10-18T02:00:00Z",
};
const daily = {
  id: "daily",
  kind: "DAILY",
  status: "APPROVED",
  organizationId: "org-1",
  region: "余杭区",
  startAt: "2026-10-16T01:00:00Z",
  endAt: "2026-10-17T10:00:00Z",
};
const longTerm = {
  ...daily,
  id: "long-term",
  kind: "LONG_TERM",
  endAt: "2026-11-16T10:00:00Z",
};

test("Oct18任务不再错误绑定只覆盖Oct16/17的日常计划", () => {
  assert.equal(selectTaskPlan(task, [daily, longTerm]), "long-term");
  assert.equal(selectTaskPlan(task, [daily]), null);
});
test("资料核对工作不冒用飞行审批", () => {
  assert.equal(
    selectTaskPlan({ ...task, scene: "资料核对" }, [longTerm]),
    null,
  );
});
test("不匹配区域、组织、类型、取消或无效时间的计划均排除", () => {
  for (const override of [
    { region: "西湖区" },
    { organizationId: "org-2" },
    { kind: "DEVICE_ADMISSION" },
    { status: "CANCELLED" },
    { endAt: "invalid" },
  ])
    assert.equal(selectTaskPlan(task, [{ ...longTerm, ...override }]), null);
  assert.equal(
    selectTaskPlan({ ...task, endAt: task.startAt }, [longTerm]),
    null,
  );
});
test("优先已有已批计划；范围内未批计划只关联，不假设通过", () => {
  assert.equal(
    selectTaskPlan(task, [
      { ...longTerm, status: "DRAFT" },
      { ...longTerm, id: "approved" },
    ]),
    "approved",
  );
  assert.equal(
    selectTaskPlan(task, [{ ...longTerm, status: "DRAFT" }]),
    "long-term",
  );
});
