// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PlanExecutionTasks from "./PlanExecutionTasks";

afterEach(() => cleanup());

it("显示首条匹配的设备档案，并区分不可见设备和待分配任务", () => {
  const navigate = vi.fn();
  render(
    <PlanExecutionTasks
      plan={{ id: "plan", status: "APPROVED" }}
      tasks={{
        items: [
          { id: "known", title: "已有设备任务", deviceId: "device" },
          { id: "hidden", title: "设备不可见任务", deviceId: "hidden-device" },
          { id: "unassigned", title: "尚未分配任务" },
        ],
        total: 3,
        page: 1,
        pageSize: 20,
      }}
      loading={false}
      error={null}
      resources={[
        { id: "device", title: "首条设备档案" },
        { id: "device", title: "后续同编号档案" },
      ]}
      role="DEPARTMENT"
      arrange
      navigate={navigate}
      onPageChange={vi.fn()}
    />,
  );
  expect(screen.getByText("首条设备档案")).toBeTruthy();
  expect(screen.queryByText("后续同编号档案")).toBeNull();
  expect(screen.getByText("设备档案不可见")).toBeTruthy();
  expect(screen.getByText("待分配")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "飞控入口检查" })).toBeNull();
  const row = screen.getByText("已有设备任务").closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "查看任务" }));
  expect(navigate).toHaveBeenCalledExactlyOnceWith("dispatch", {
    taskId: "known",
    planId: "plan",
  });
});
