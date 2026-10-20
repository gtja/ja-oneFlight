// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "./api";
import { FeedbackContext } from "./context";
import FlightOperationControls from "./components/FlightOperationControls";
import {
  getFlightControlGate,
  type FlightControlContext,
} from "./flightControls";

function context(): FlightControlContext {
  return {
    device: { id: "900719925474099312345", status: "UNKNOWN" },
    resource: {
      id: "resource-1",
      kind: "DEVICE",
      status: "ACTIVE",
      sourceDeviceId: "900719925474099312345",
      organizationId: "org-1",
      region: "西湖区",
    },
    task: {
      id: "task-1",
      deviceId: "resource-1",
      pilotId: "pilot-1",
      planId: "plan-1",
      status: "PENDING_EXECUTION",
      organizationId: "org-1",
      region: "西湖区",
      startAt: "2026-10-16T01:00:00Z",
      endAt: "2026-10-16T02:00:00Z",
    },
    plan: {
      id: "plan-1",
      title: "西湖片区日常巡查计划",
      kind: "DAILY",
      status: "APPROVED",
      organizationId: "org-1",
      region: "西湖区",
      startAt: "2026-10-16T00:00:00Z",
      endAt: "2026-10-23T10:00:00Z",
    },
    user: {
      id: "admin-1",
      role: "ADMIN",
      username: "admin",
      displayName: "管理员",
      organizationId: "org-1",
      regions: [],
      deviceIds: [],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("审批解锁页面作业按钮", () => {
  it.each(["DAILY", "LONG_TERM"])(
    "%s通过且准确关联时解锁，不依赖在线遥测",
    (kind) => {
      const input = context();
      input.plan!.kind = kind;
      input.plan!.resourceId = "route-1";
      input.plan!.startAt = "2025-01-01T00:00:00Z";
      input.plan!.endAt = "2025-01-02T00:00:00Z";
      input.task!.startAt = "2025-01-01T01:00:00Z";
      input.task!.endAt = "2025-01-01T02:00:00Z";
      expect(getFlightControlGate(input)).toMatchObject({
        enabled: true,
        code: "APPROVED",
      });
      input.task!.status = "EXECUTING";
      expect(getFlightControlGate(input).enabled).toBe(true);
    },
  );

  it.each(["DRAFT", "PENDING_REVIEW", "RETURNED", "CANCELLED", undefined])(
    "计划%s不能解锁",
    (status) => {
      const input = context();
      input.plan!.status = status;
      expect(getFlightControlGate(input)).toMatchObject({
        enabled: false,
        code: "APPROVAL_REQUIRED",
      });
    },
  );

  it.each([
    "DRAFT",
    "RETURNED",
    "PENDING_ASSIGNMENT",
    "PENDING_ACCEPTANCE",
    "COMPLETED",
    "CANCELLED",
    undefined,
  ])("任务%s不允许作业交互", (status) => {
    const input = context();
    input.task!.status = status;
    expect(getFlightControlGate(input).code).toBe("TASK_NOT_EXECUTABLE");
  });

  it.each(["MAINTENANCE", "INACTIVE", "PENDING_CONFIRMATION", undefined])(
    "设备调度资料%s保持锁定",
    (status) => {
      const input = context();
      input.resource!.status = status;
      expect(getFlightControlGate(input).code).toBe("RESOURCE_UNAVAILABLE");
    },
  );

  it("资料加载或请求失败时不采用残留已通过审批结果", () => {
    expect(getFlightControlGate({ ...context(), loading: true }).code).toBe(
      "LOADING",
    );
    expect(
      getFlightControlGate({ ...context(), error: new Error("离线") }).code,
    ).toBe("LOAD_ERROR");
    expect(
      getFlightControlGate({
        ...context(),
        loading: true,
        error: new Error("离线"),
      }).code,
    ).toBe("LOAD_ERROR");
  });

  it("缺少设备、任务、计划时说明唯一阻塞原因", () => {
    expect(getFlightControlGate({ ...context(), device: undefined }).code).toBe(
      "NO_DEVICE",
    );
    expect(getFlightControlGate({ ...context(), task: undefined }).code).toBe(
      "NO_TASK",
    );
    const noPlan = context();
    delete noPlan.task!.planId;
    expect(getFlightControlGate(noPlan).code).toBe("NO_PLAN");
    expect(getFlightControlGate({ ...context(), plan: undefined }).code).toBe(
      "PLAN_MISMATCH",
    );
  });

  it("设备、调度档案、任务必须逐级准确绑定，长ID保持字符串", () => {
    const input = context();
    input.device!.id = "900719925474099312346";
    expect(getFlightControlGate(input).code).toBe("DEVICE_MISMATCH");
    input.device!.id = "900719925474099312345";
    input.task!.deviceId = "other-resource";
    expect(getFlightControlGate(input).code).toBe("DEVICE_MISMATCH");
    input.task!.deviceId = input.resource!.id;
    input.resource!.kind = "ROUTE";
    expect(getFlightControlGate(input).code).toBe("DEVICE_MISMATCH");
  });

  it("管理员也必须等任务分配执行飞手后才能交互", () => {
    for (const pilotId of [undefined, null, "", "   ", 123]) {
      const input = context();
      input.task!.pilotId = pilotId;
      expect(getFlightControlGate(input)).toMatchObject({
        enabled: false,
        code: "NO_PILOT",
      });
    }
  });

  it("其他计划通过和准入审批不能解锁，同一长期计划允许多个执行任务", () => {
    const input = context();
    input.plan!.id = "other-plan";
    expect(getFlightControlGate(input).code).toBe("PLAN_MISMATCH");
    input.plan!.id = "plan-1";
    input.plan!.taskId = "other-task";
    input.plan!.kind = "LONG_TERM";
    expect(getFlightControlGate(input).enabled).toBe(true);
    input.plan!.kind = "DEVICE_ACCESS";
    expect(getFlightControlGate(input).code).toBe("INVALID_PLAN_KIND");
  });

  it("已通过计划也必须覆盖当前任务的区域和完整作业时段", () => {
    const input = context();
    input.task!.region = "余杭区";
    expect(getFlightControlGate(input).code).toBe("PLAN_REGION_MISMATCH");
    input.task!.region = "西湖区";
    input.task!.endAt = "2026-10-24T02:00:00Z";
    expect(getFlightControlGate(input).code).toBe("PLAN_TIME_MISMATCH");
    input.task!.endAt = "2026-10-16T02:00:00Z";
    delete input.plan!.startAt;
    expect(getFlightControlGate(input).code).toBe("PLAN_TIME_INVALID");
  });
});

describe("角色及设备授权范围", () => {
  function as(role: CurrentUser["role"]): FlightControlContext {
    const input = context();
    input.user.role = role;
    input.user.regions = ["西湖区"];
    input.user.deviceIds = [input.resource!.id];
    return input;
  }

  it("调度可按本地设备ID或来源ID取得授权，跨组织仅接受显式授权", () => {
    const input = as("DISPATCH");
    expect(getFlightControlGate(input).enabled).toBe(true);
    input.user.deviceIds = [String(input.resource!.sourceDeviceId)];
    expect(getFlightControlGate(input).enabled).toBe(true);
    input.user.organizationId = "other-org";
    expect(getFlightControlGate(input).code).toBe("SCOPE_FORBIDDEN");
    input.user.organizationIds = ["org-1"];
    expect(getFlightControlGate(input).enabled).toBe(true);
  });

  it("飞手仅操作本人任务且必须仍有设备和组织区域权限", () => {
    const input = as("PILOT");
    expect(getFlightControlGate(input).code).toBe("ROLE_FORBIDDEN");
    input.user.id = "pilot-1";
    expect(getFlightControlGate(input).enabled).toBe(true);
    input.user.deviceIds = [];
    expect(getFlightControlGate(input).code).toBe("DEVICE_FORBIDDEN");
    input.user.deviceIds = [input.resource!.id];
    input.user.regions = ["拱墅区"];
    expect(getFlightControlGate(input).code).toBe("SCOPE_FORBIDDEN");
    input.user.regions = [];
    input.user.organizationId = "other-org";
    input.user.organizationIds = ["org-1"];
    expect(getFlightControlGate(input).code).toBe("SCOPE_FORBIDDEN");
  });

  it("需求部门始终只读，管理员无需本地设备授权，但仍须关联正确且审批通过", () => {
    expect(getFlightControlGate(as("DEPARTMENT")).code).toBe("ROLE_FORBIDDEN");
    const input = context();
    input.user.organizationId = "other-org";
    input.user.regions = ["拱墅区"];
    expect(getFlightControlGate(input).enabled).toBe(true);
    input.plan!.status = "PENDING_REVIEW";
    expect(getFlightControlGate(input).enabled).toBe(false);
  });

  it.each(["resource", "task", "plan"] as const)(
    "%s单项越权也保持锁定",
    (key) => {
      const input = as("DISPATCH");
      input[key]!.organizationId = "other-org";
      expect(getFlightControlGate(input).code).toBe("SCOPE_FORBIDDEN");
      input[key]!.organizationId = "org-1";
      input[key]!.region = "拱墅区";
      expect(getFlightControlGate(input).code).toBe("SCOPE_FORBIDDEN");
    },
  );
});

describe("按钮仅更新页面操作反馈", () => {
  it("审批通过五按钮可依次点击，零网络请求且不改任务/遥测数据", () => {
    const input = context();
    const before = JSON.stringify(input);
    const network = vi.fn(() => Promise.reject(new Error("不应调用网络")));
    vi.stubGlobal("fetch", network);
    const feedback = vi.fn();
    render(
      createElement(
        FeedbackContext.Provider,
        { value: feedback },
        createElement(FlightOperationControls, input),
      ),
    );
    const controls = screen.getByTestId("flight-operation-controls");
    expect(controls.getAttribute("data-control-enabled")).toBe("true");
    for (const label of [
      "下发任务",
      "立即起飞",
      "暂停作业",
      "立即返航",
      "确认落地并结束",
    ]) {
      const button = screen.getByRole("button", {
        name: label,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(feedback).toHaveBeenLastCalledWith(
        `已点击“${label}”，未发送设备指令。`,
      );
    }
    expect(controls.getAttribute("data-local-state")).toBe("LAND");
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).toBe(before);
    expect(
      screen.getByText(
        "仅页面交互，不发送设备指令。任务进度和设备观测保持原值。",
      ),
    ).toBeTruthy();
  });

  it("审批撤回立即禁用并清除本地提示，改选任务或重新获批不保留旧操作", () => {
    const input = context();
    const view = render(createElement(FlightOperationControls, input));
    fireEvent.click(screen.getByRole("button", { name: "立即起飞" }));
    expect(
      screen
        .getByTestId("flight-operation-controls")
        .getAttribute("data-local-state"),
    ).toBe("TAKEOFF");
    const revoked = { ...input, plan: { ...input.plan!, status: "RETURNED" } };
    view.rerender(createElement(FlightOperationControls, revoked));
    expect(
      screen
        .getByTestId("flight-operation-controls")
        .getAttribute("data-local-state"),
    ).toBe("IDLE");
    for (const button of screen.getAllByRole("button"))
      expect((button as HTMLButtonElement).disabled).toBe(true);
    view.rerender(createElement(FlightOperationControls, input));
    expect(
      screen
        .getByTestId("flight-operation-controls")
        .getAttribute("data-local-state"),
    ).toBe("IDLE");
    fireEvent.click(screen.getByRole("button", { name: "下发任务" }));
    view.rerender(
      createElement(FlightOperationControls, {
        ...input,
        task: { ...input.task!, id: "task-2" },
      }),
    );
    expect(
      screen
        .getByTestId("flight-operation-controls")
        .getAttribute("data-local-state"),
    ).toBe("IDLE");
  });
});
