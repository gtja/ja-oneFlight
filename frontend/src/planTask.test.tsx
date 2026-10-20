// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "./api";
import { PlanTaskForm } from "./components/PlanTaskModal";
import {
  defaultPlanTaskWindow,
  planTaskValidation,
  type PlanTaskInput,
} from "./planTask";

const plan: Entity = {
  id: "plan-long",
  title: "重点巡查区域周期飞行计划",
  kind: "LONG_TERM",
  status: "APPROVED",
  organizationId: "org-1",
  region: "余杭区",
  startAt: "2028-10-16T01:00:00Z",
  endAt: "2028-10-23T10:00:00Z",
  scope: "重点巡查区域作业，提交图像及处置说明。",
};
const input = (): PlanTaskInput => ({
  title: "本次巡查",
  scene: "森林防火",
  description: "提交影像",
  priority: "NORMAL",
  startAt: "2028-10-17T01:00:00Z",
  endAt: "2028-10-17T02:00:00Z",
  requestId: "abbd6ebc-f1c4-4faf-a88c-a4b53fd2d40c",
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("长期计划分次安排执行任务", () => {
  it("默认安排约一小时，不将整周当作单次任务", () => {
    const result = defaultPlanTaskWindow(
      plan,
      Date.parse("2028-10-15T00:00:00Z"),
    );
    expect(result).toEqual({
      startAt: "2028-10-16T01:00:00.000Z",
      endAt: "2028-10-16T02:00:00.000Z",
    });
  });
  it("有效期内从下一分钟安排，剩余不足一小时按有效期结束", () => {
    const result = defaultPlanTaskWindow(
      plan,
      Date.parse("2028-10-23T09:40:20Z"),
    );
    expect(result.startAt).toBe("2028-10-23T09:41:00.000Z");
    expect(result.endAt).toBe("2028-10-23T10:00:00.000Z");
  });
  it("缺失或倒置计划时段不猜测日期", () => {
    expect(defaultPlanTaskWindow({ ...plan, endAt: undefined })).toEqual({
      startAt: "",
      endAt: "",
    });
    expect(defaultPlanTaskWindow({ ...plan, endAt: plan.startAt })).toEqual({
      startAt: "",
      endAt: "",
    });
  });
  it("完整覆盖的子任务可沿用长期计划审批", () =>
    expect(planTaskValidation(plan, input())).toBe(""));
  it.each(["DRAFT", "PENDING_REVIEW", "RETURNED", "CANCELLED"])(
    "%s 计划不能安排",
    (status) =>
      expect(planTaskValidation({ ...plan, status }, input())).toContain(
        "尚未审批通过",
      ),
  );
  it("准入事项不能安排执行任务", () =>
    expect(
      planTaskValidation({ ...plan, kind: "DEVICE_ADMISSION" }, input()),
    ).toContain("只能关联日常或长期"));
  it.each([
    ["早于计划", { startAt: "2028-10-15T01:00:00Z" }],
    ["晚于计划", { endAt: "2028-10-24T01:00:00Z" }],
    ["倒置", { endAt: "2028-10-16T01:00:00Z" }],
  ])("拒绝%s时段", (_name, times) =>
    expect(planTaskValidation(plan, { ...input(), ...times })).not.toBe(""),
  );
});

describe("安排执行任务表单", () => {
  function form(
    onSubmit = vi.fn(async (_body: PlanTaskInput): Promise<void> => {}),
  ) {
    render(
      <PlanTaskForm
        plan={plan}
        organizationName="林业巡查部门"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    return onSubmit;
  }
  it("部门与区域继承计划，不提交可篡改的归属字段", async () => {
    const onSubmit = form();
    expect(screen.getByText("林业巡查部门")).toBeTruthy();
    expect(screen.getByText("余杭区")).toBeTruthy();
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const body = onSubmit.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(
      [
        "title",
        "scene",
        "description",
        "priority",
        "startAt",
        "endAt",
        "requestId",
      ].sort(),
    );
    expect(Date.parse(body.endAt) - Date.parse(body.startAt)).toBe(3_600_000);
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("场景与紧急程度通过统一菜单选择，提交保持原始业务值", async () => {
    const onSubmit = form();
    fireEvent.click(screen.getByRole("combobox", { name: "应用场景*" }));
    fireEvent.click(screen.getByRole("option", { name: "矿产监管" }));
    fireEvent.click(screen.getByRole("combobox", { name: "紧急程度" }));
    fireEvent.click(screen.getByRole("option", { name: "紧急" }));
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      scene: "矿产监管",
      priority: "URGENT",
    });
  });
  it("失败重试保留本次表单请求ID和内容，避免重复任务", async () => {
    const onSubmit = vi
      .fn(async (_body: PlanTaskInput) => undefined)
      .mockRejectedValueOnce(new Error("来源响应暂不可用，请重试"));
    form(onSubmit);
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    await screen.findByRole("alert");
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[0][0]).toEqual(onSubmit.mock.calls[1][0]);
  });
  it("请求处理中禁用提交，重复提交不增加请求", async () => {
    let finish!: () => void;
    const onSubmit = vi.fn(
      (_body: PlanTaskInput) =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    form(onSubmit);
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    expect(
      (
        screen.getByRole("button", {
          name: "创建并进入任务调度",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    finish();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "创建并进入任务调度",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });
  it("超出计划有效期时在页面阻止提交，并说明原因", async () => {
    const onSubmit = form();
    fireEvent.change(screen.getByLabelText(/作业结束时间/), {
      target: { value: "2028-10-24T12:00" },
    });
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "完整包含在飞行计划有效期内",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
  it("表单提交时再校验审批状态", async () => {
    const onSubmit = vi.fn(async (_body: PlanTaskInput) => undefined);
    render(
      <PlanTaskForm
        plan={{ ...plan, status: "RETURNED" }}
        organizationName="林业巡查部门"
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.submit(screen.getByTestId("plan-task-form"));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "尚未审批通过",
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
