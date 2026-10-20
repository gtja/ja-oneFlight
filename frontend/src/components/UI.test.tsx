// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EntityForm, Modal } from "./UI";

afterEach(cleanup);

describe("弹窗键盘事件", () => {
  it("Escape 只关闭顶层弹窗，阻止全局监听并恢复触发按钮焦点", () => {
    const onBaseClose = vi.fn();
    const onGlobalEscape = vi.fn();
    function NestedDialogs() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Modal title="底层弹窗" onClose={onBaseClose}>
            <button onClick={() => setOpen(true)}>打开任务明细</button>
          </Modal>
          {open && (
            <Modal title="任务明细" onClose={() => setOpen(false)}>
              任务信息
            </Modal>
          )}
        </>
      );
    }
    window.addEventListener("keydown", onGlobalEscape);
    try {
      render(<NestedDialogs />);
      const trigger = screen.getByRole("button", { name: "打开任务明细" });
      trigger.focus();
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "任务明细" });
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "关闭" }),
      );

      fireEvent.keyDown(dialog, { key: "Escape" });

      expect(screen.queryByRole("dialog", { name: "任务明细" })).toBeNull();
      expect(screen.getByRole("dialog", { name: "底层弹窗" })).toBeTruthy();
      expect(onBaseClose).not.toHaveBeenCalled();
      expect(onGlobalEscape).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    } finally {
      window.removeEventListener("keydown", onGlobalEscape);
    }
  });
});

describe("统一下拉表单的提交约束", () => {
  it("必填下拉为空时提示并聚焦，不调用提交", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[
          {
            key: "region",
            label: "作业区域",
            required: true,
            options: [{ value: "余杭区", label: "余杭区" }],
          },
        ]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择作业区域");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("combobox", { name: /作业区域/ }),
    );
  });
  it("可通过真实菜单选择再提交，保留未修改的可选历史引用", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <EntityForm
        fields={[
          {
            key: "region",
            label: "作业区域",
            required: true,
            options: [{ value: "余杭区", label: "余杭区" }],
          },
          {
            key: "resourceId",
            label: "关联资料",
            options: [{ value: "device-1", label: "飞机一号" }],
          },
        ]}
        initial={{ resourceId: "route-1" }}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /作业区域/ }));
    fireEvent.click(
      screen.getByRole("option", { name: "余杭区" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        region: "余杭区",
        resourceId: "route-1",
      }),
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("必填选项从目录移除后不提交旧值", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[
          { key: "deviceId", label: "执行设备", required: true, options: [] },
        ]}
        initial={{ deviceId: "unavailable-device" }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请选择执行设备");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
