// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskAssignmentForm } from "./components/TaskAssignmentModal";
import {
  assignmentSelection,
  type TaskAssignmentOptions,
} from "./taskAssignment";

function options(): TaskAssignmentOptions {
  return {
    taskId: "task-1",
    taskStatus: "PENDING_ASSIGNMENT",
    region: "西湖区",
    organizationId: "org-1",
    startAt: "2026-10-16T01:00:00Z",
    endAt: "2026-10-16T02:00:00Z",
    selectedDeviceId: "device-1",
    summary: {
      deviceCount: 3,
      activeDeviceCount: 2,
      pendingDeviceCount: 1,
      availableDeviceCount: 2,
      pilotCount: 2,
      availablePilotCount: 1,
    },
    devices: [
      {
        id: "device-1",
        title: "常州-006",
        status: "ACTIVE",
        region: "余杭区",
        organizationId: "org-1",
        eligible: true,
        reasons: [],
        compatiblePilotCount: 1,
      },
      {
        id: "device-2",
        title: "M4TD",
        status: "ACTIVE",
        region: "余杭区",
        organizationId: "org-1",
        eligible: true,
        reasons: [],
        compatiblePilotCount: 1,
      },
      {
        id: "device-3",
        title: "待确认来源设备",
        status: "PENDING_CONFIRMATION",
        region: "未知",
        organizationId: "org-1",
        eligible: false,
        reasons: [
          {
            code: "DEVICE_PENDING_CONFIRMATION",
            message: "设备调度资料待确认，请先完善资料",
          },
        ],
        compatiblePilotCount: 0,
      },
    ],
    pilots: [
      {
        id: "pilot-1",
        title: "西湖执行岗",
        organizationId: "org-1",
        regions: ["西湖区"],
        eligible: true,
        reasons: [],
      },
      {
        id: "pilot-2",
        title: "飞行排班岗",
        organizationId: "org-1",
        regions: ["余杭区"],
        eligible: false,
        reasons: [
          {
            code: "PILOT_REGION",
            message: "飞手仅授权区域“余杭区”，未获任务区域“西湖区”的执行权限",
          },
        ],
      },
    ],
    reasons: [],
  };
}
const task = {
  id: "task-1",
  title: "西湖巡查",
  region: "西湖区",
  startAt: "2026-10-16T01:00:00Z",
  endAt: "2026-10-16T02:00:00Z",
};
function props() {
  return {
    task,
    plans: [{ value: "plan-1", label: "日常计划 · 已通过" }],
    options: options(),
    deviceId: "device-1",
    onDeviceChange: vi.fn(),
    navigate: vi.fn(),
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onSubmit: vi.fn(async (_body: Record<string, string>) => undefined),
  };
}
function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
afterEach(cleanup);

describe("任务分配以服务端规则和设备飞手组合为准", () => {
  it("跨驻地区域不添加前端限制，服务端给出可用组合即可分配", () => {
    expect(assignmentSelection(options(), "device-1", "pilot-1")).toMatchObject(
      { ready: true },
    );
  });
  it.each([
    [undefined, "device-1", "pilot-1", true, null],
    [options(), "device-1", "pilot-1", false, new Error("断网")],
    [options(), "", "pilot-1", false, null],
    [options(), "device-1", "", false, null],
    [options(), "device-3", "pilot-1", false, null],
    [options(), "device-1", "pilot-2", false, null],
    [options(), "device-2", "pilot-1", false, null],
  ] as const)(
    "资料不齐、失败、无效组合或设备核验未完成时关闭提交 %#",
    (data, deviceId, pilotId, loading, error) => {
      expect(
        assignmentSelection(data, deviceId, pilotId, loading, error).ready,
      ).toBe(false);
    },
  );
  it("任务状态及时间错误保留服务端明确原因", () => {
    const data = options();
    data.reasons = [
      { code: "TASK_TIME", message: "任务结束时间须晚于开始时间" },
    ];
    expect(assignmentSelection(data, "device-1", "pilot-1")).toEqual({
      ready: false,
      reason: "任务结束时间须晚于开始时间",
    });
  });
  it("无合格飞手时不给默认值、不允许提交，直接显示区域原因", () => {
    const input = props();
    input.options.pilots = [input.options.pilots[1]];
    input.options.summary.availableDeviceCount = 0;
    render(<TaskAssignmentForm {...input} />);
    expect(
      screen.getByRole("combobox", { name: "执行飞手*" }).textContent,
    ).toContain("请选择可用飞手");
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByLabelText("飞手不可分配原因").textContent).toContain(
      "飞手仅授权区域“余杭区”",
    );
    fireEvent.submit(screen.getByTestId("task-assignment-form"));
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
  it("全部设备可见，待确认设备和越区飞手均禁选，统计说明接入与调度差别", () => {
    const input = props();
    render(<TaskAssignmentForm {...input} />);
    fireEvent.click(screen.getByRole("combobox", { name: "执行设备*" }));
    const pendingDevice = screen.getByRole("option", {
      name: /待确认来源设备/,
    });
    expect(pendingDevice.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(pendingDevice);
    expect(input.onDeviceChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "执行设备*" }), {
      key: "Escape",
    });
    fireEvent.click(screen.getByRole("combobox", { name: "执行飞手*" }));
    const unavailablePilot = screen.getByRole("option", { name: /飞行排班岗/ });
    expect(unavailablePilot.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(unavailablePilot);
    expect(
      screen.getByRole("combobox", { name: "执行飞手*" }).textContent,
    ).toContain("请选择可用飞手");
    expect(
      screen.getByLabelText("设备接入与任务分配范围").textContent,
    ).toContain("待确认 1 台");
    expect(screen.getByText(/设备接入后可查看观测数据/)).toBeTruthy();
  });
  it("选设备后才允许选择飞手，设备切换立即清空飞手，不复用旧组合", () => {
    const input = props();
    const { rerender } = render(<TaskAssignmentForm {...input} />);
    choose("执行飞手*", "西湖执行岗");
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    choose("执行设备*", /M4TD/);
    expect(input.onDeviceChange).toHaveBeenCalledWith("device-2");
    expect(
      screen.getByRole("combobox", { name: "执行飞手*" }).textContent,
    ).toContain("请选择可用飞手");
    rerender(<TaskAssignmentForm {...input} deviceId="device-2" />);
    expect(
      (screen.getByRole("combobox", { name: "执行飞手*" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("权限刷新撤销后清空已选飞手，查询失败和刷新中均不使用旧可用结果", async () => {
    const input = props();
    const { rerender } = render(<TaskAssignmentForm {...input} />);
    choose("执行飞手*", "西湖执行岗");
    rerender(<TaskAssignmentForm {...input} loading />);
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    rerender(<TaskAssignmentForm {...input} error={new Error("接口超时")} />);
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const revoked = options();
    revoked.pilots[0] = {
      ...revoked.pilots[0],
      eligible: false,
      reasons: [{ code: "PILOT_DEVICE", message: "飞手未授权使用所选设备" }],
    };
    rerender(<TaskAssignmentForm {...input} options={revoked} />);
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "执行飞手*" }).textContent,
      ).toContain("请选择可用飞手"),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("明确设备资料和飞手权限修复入口，不保存授权或分配", () => {
    const input = props();
    render(<TaskAssignmentForm {...input} />);
    fireEvent.click(screen.getByRole("button", { name: "查看飞手权限" }));
    expect(input.navigate).toHaveBeenCalledWith("settings", {
      userId: "pilot-2",
    });
    fireEvent.click(screen.getByRole("button", { name: "完善设备调度资料" }));
    expect(input.navigate).toHaveBeenCalledWith("resources", undefined);
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
  it("具备调度资格但暂无匹配飞手的设备仍可选择检查原因", () => {
    const input = props();
    input.options.devices[1].compatiblePilotCount = 0;
    render(<TaskAssignmentForm {...input} />);
    fireEvent.click(screen.getByRole("combobox", { name: "执行设备*" }));
    const noPilotDevice = screen.getByRole("option", { name: /M4TD/ });
    expect(noPilotDevice.getAttribute("aria-disabled")).not.toBe("true");
    expect(noPilotDevice.textContent).toContain("暂无匹配飞手");
    fireEvent.click(noPilotDevice);
    expect(input.onDeviceChange).toHaveBeenCalledWith("device-2");
  });
  it("计划可清空为稍后关联，原关联计划无效时仍阻止误提交", () => {
    const input = props();
    render(
      <TaskAssignmentForm
        {...input}
        task={{ ...task, planId: "plan-invisible" }}
      />,
    );
    choose("执行飞手*", "西湖执行岗");
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("combobox", { name: "关联飞行计划" }).textContent,
    ).toContain("原关联计划不匹配或不可见，请更换");
    choose("关联飞行计划", "稍后关联日常或长期计划");
    expect(
      (
        screen.getByRole("button", {
          name: "分配执行资源",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(input.onSubmit).not.toHaveBeenCalled();
  });
  it("仅有效组合可提交，带上计划和办理说明，后端失败显示原始原因", async () => {
    const input = props();
    input.onSubmit = vi.fn(async (_body: Record<string, string>) => {
      throw new Error("设备在该时段已被占用，请重新分配");
    });
    render(<TaskAssignmentForm {...input} />);
    choose("执行飞手*", "西湖执行岗");
    choose("关联飞行计划", "日常计划 · 已通过");
    fireEvent.change(screen.getByLabelText("办理说明"), {
      target: { value: "按计划执行" },
    });
    fireEvent.submit(screen.getByTestId("task-assignment-form"));
    await waitFor(() =>
      expect(input.onSubmit).toHaveBeenCalledWith({
        deviceId: "device-1",
        pilotId: "pilot-1",
        planId: "plan-1",
        note: "按计划执行",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "设备在该时段已被占用，请重新分配",
    );
    expect(input.onClose).not.toHaveBeenCalled();
  });
});
