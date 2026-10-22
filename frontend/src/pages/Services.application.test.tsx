// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Services from "./Services";
import { UserContext } from "../context";
import type { CurrentUser, Entity } from "../api";
import type { Navigate } from "../navigation";

const fixtures = vi.hoisted(() => ({
  plan: undefined as Entity | undefined,
  write: vi.fn(),
}));
vi.mock("../api", () => ({
  entityName: (entity?: Entity) =>
    String(entity?.title || entity?.name || "未命名"),
  useList: () => ({
    data: { items: [], total: 0, page: 1, pageSize: 20 },
    isLoading: false,
    error: null,
    setPage: vi.fn(),
  }),
  useData: (path: string) => ({
    data:
      path === "/dashboard"
        ? { planCounts: {} }
        : path.startsWith("/plans/")
          ? fixtures.plan
          : undefined,
    isLoading: false,
    error: null,
  }),
  useCatalog: (path: string) => ({
    data: {
      items:
        path === "/organizations"
          ? [{ id: "org", title: "申请部门" }]
          : path === "/resources"
            ? [
                { id: "device", title: "执行设备", kind: "DEVICE" },
                { id: "person", title: "人员档案", kind: "PERSON" },
              ]
            : [],
    },
    isLoading: false,
    error: null,
  }),
  write: fixtures.write,
}));
vi.mock("../components/Workflow", () => ({
  useMutationFeedback: () => async (action: () => Promise<unknown>) => action(),
  History: () => null,
  Provenance: () => null,
  ActionModal: () => null,
}));
vi.mock("../components/SourceRecords", () => ({ default: () => null }));
vi.mock("../components/PlanTaskModal", () => ({
  default: ({
    plan,
    onCreated,
  }: {
    plan: Entity;
    onCreated: (task: Entity) => void;
  }) => (
    <div role="dialog" aria-label="安排执行任务">
      {String(plan.title)}
      <button
        onClick={() => onCreated({ id: "arranged-task", planId: plan.id })}
      >
        确认安排任务
      </button>
    </div>
  ),
}));

const user: CurrentUser = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  role: "ADMIN",
  organizationId: "org",
  regions: ["西湖区"],
  deviceIds: [],
  businessAccessAssigned: true,
};
function start(
  props: { initialAction?: string; planId?: string; navigate?: Navigate } = {},
) {
  return render(
    <UserContext.Provider value={user}>
      <Services {...props} />
    </UserContext.Provider>,
  );
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
beforeEach(() => {
  fixtures.plan = undefined;
  fixtures.write.mockReset().mockResolvedValue({ id: "new-plan" });
});
afterEach(() => cleanup());

describe("飞行申请直达与精简表单", () => {
  it("apply直达普通申请，默认日常，证照与可选关联默认收起", () => {
    start({ initialAction: "apply" });
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("textbox", { name: /申请名称/ }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("combobox", { name: /申请类型/ }).textContent,
    ).toContain("日常计划");
    expect(
      within(dialog).getByRole("combobox", { name: /适用区域/ }).textContent,
    ).toContain("西湖区");
    expect(
      within(dialog).getByRole("combobox", { name: /申请部门/ }).textContent,
    ).toContain("申请部门");
    expect(within(dialog).queryByLabelText(/证照/)).toBeNull();
    expect(within(dialog).queryByLabelText(/资格/)).toBeNull();
    expect(within(dialog).queryByLabelText(/高度/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("combobox", { name: /申请类型/ }));
    expect(screen.getByRole("option", { name: "长期计划" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "设备准入" })).toBeNull();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it("展开和收起更多选项保留输入，确认后仅新建计划并提交审核", async () => {
    start({ initialAction: "apply" });
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: /申请名称/ }),
      { target: { value: "西湖巡检" } },
    );
    fireEvent.change(within(dialog).getByLabelText(/开始时间/), {
      target: { value: "2028-10-21T09:00" },
    });
    fireEvent.change(within(dialog).getByLabelText(/结束时间/), {
      target: { value: "2028-10-21T10:00" },
    });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: /飞行范围 \/ 用途/ }),
      { target: { value: "西湖巡检范围" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "更多选项" }));
    fireEvent.change(within(dialog).getByLabelText(/申请高度/), {
      target: { value: "120" },
    });
    choose("关联设备（可选）", "执行设备");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "收起更多选项" }),
    );
    expect(
      (
        within(dialog).getByRole("textbox", {
          name: /申请名称/,
        }) as HTMLInputElement
      ).value,
    ).toBe("西湖巡检");
    fireEvent.click(within(dialog).getByRole("button", { name: "提交申请" }));
    await waitFor(() => expect(fixtures.write).toHaveBeenCalledTimes(2));
    expect(fixtures.write.mock.calls[0][0]).toBe("/plans");
    expect(fixtures.write.mock.calls[0][1]).toMatchObject({
      title: "西湖巡检",
      kind: "DAILY",
      region: "西湖区",
      organizationId: "org",
      scope: "西湖巡检范围",
      height: 120,
      resourceId: "device",
    });
    expect(fixtures.write.mock.calls[0][1]).not.toHaveProperty("taskId");
    expect(fixtures.write.mock.calls[1]).toEqual([
      "/plans/new-plan/actions",
      { action: "SUBMIT" },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("准入申请继续展示材料字段，类型与普通飞行申请分开", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "准入申请" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("资格 / 材料名称")).toBeTruthy();
    expect(within(dialog).getByLabelText("证照 / 材料编号")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("combobox", { name: /申请类型/ }));
    expect(screen.getByRole("option", { name: "人员准入" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "日常计划" })).toBeNull();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it("有效已批计划直达安排任务，复用既有审批且不自动写入", async () => {
    fixtures.plan = {
      id: "approved-plan",
      title: "有效已批计划",
      kind: "LONG_TERM",
      status: "APPROVED",
      organizationId: "org",
      region: "西湖区",
      scope: "原范围",
      startAt: new Date(Date.now() - 3600000).toISOString(),
      endAt: new Date(Date.now() + 3600000).toISOString(),
    };
    const navigate = vi.fn();
    start({ initialAction: "apply", planId: "approved-plan", navigate });
    expect(
      await screen.findByRole("dialog", { name: "安排执行任务" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "提交申请" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认安排任务" }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith("dispatch", {
      taskId: "arranged-task",
      planId: "approved-plan",
      action: "assign",
    });
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it("过期计划只带入范围与归属，新申请时间与回执不沿用", async () => {
    fixtures.plan = {
      id: "expired-plan",
      title: "旧计划",
      kind: "LONG_TERM",
      status: "APPROVED",
      organizationId: "org",
      region: "西湖区",
      scope: "原范围",
      height: 90,
      startAt: "2020-01-01T00:00:00Z",
      endAt: "2020-01-02T00:00:00Z",
      receiptNumber: "old-receipt",
      taskId: "old-task",
    };
    start({ initialAction: "apply", planId: "expired-plan" });
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("原计划已过期，请重新选择申请时段并提交审核。"),
    ).toBeTruthy();
    expect(
      (within(dialog).getByLabelText(/开始时间/) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (within(dialog).getByLabelText(/结束时间/) as HTMLInputElement).value,
    ).toBe("");
    expect(
      (
        within(dialog).getByRole("textbox", {
          name: /申请名称/,
        }) as HTMLInputElement
      ).value,
    ).toBe("");
    expect(
      (
        within(dialog).getByRole("textbox", {
          name: /飞行范围 \/ 用途/,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe("原范围");
    expect(within(dialog).queryByText("old-receipt")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "更多选项" }));
    expect(
      (within(dialog).getByLabelText(/申请高度/) as HTMLInputElement).value,
    ).toBe("");
    expect(fixtures.write).not.toHaveBeenCalled();
  });
});
