// @vitest-environment jsdom
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SelectControl, { type SelectOption } from "./SelectControl";

const options: SelectOption[] = [
  { value: "", label: "请选择" },
  { value: "normal", label: "常规" },
  {
    value: "blocked",
    label: "受限设备",
    disabled: true,
    description: "缺少该设备的执行权限",
  },
  { value: "urgent", label: "紧急" },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Controlled({
  initial = "normal",
  items = options,
  searchable = false,
}: {
  initial?: string;
  items?: SelectOption[];
  searchable?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="priority">优先级</label>
      <SelectControl
        id="priority"
        value={value}
        onChange={setValue}
        options={items}
        searchable={searchable}
      />
      <button type="button">下一项</button>
    </>
  );
}

describe("统一深色下拉交互", () => {
  it("表单标签关联触发器，选项挂载到 body 且不使用原生 select", () => {
    const { container } = render(<Controlled />);
    const trigger = screen.getByRole("combobox", { name: "优先级" });
    expect(trigger.getAttribute("data-value")).toBe("normal");
    expect(trigger.getAttribute("title")).toBe("常规");
    expect(trigger.getAttribute("type")).toBe("button");
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox");
    expect(container.contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
    expect(container.querySelector("select")).toBeNull();
    expect(
      screen
        .getByRole("option", { name: "常规" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(list.id);
  });

  it("点击选择后更新显示、收起菜单并恢复焦点", () => {
    render(<Controlled />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "紧急" }));
    expect(trigger.getAttribute("data-value")).toBe("urgent");
    expect(trigger.textContent).toBe("紧急");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("显式空值选项可以清空已选值", () => {
    render(<Controlled />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "请选择" }));
    expect(screen.getByRole("combobox").getAttribute("data-value")).toBe("");
  });

  it("禁用项显示原因且无法点击，禁用整个组件无法展开", () => {
    const change = vi.fn();
    const { rerender } = render(
      <SelectControl
        aria-label="设备"
        value="normal"
        onChange={change}
        options={options}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    const unavailable = screen.getByRole("option", { name: /受限设备/ });
    expect(unavailable.getAttribute("aria-disabled")).toBe("true");
    expect(within(unavailable).getByText("缺少该设备的执行权限")).toBeTruthy();
    fireEvent.click(unavailable);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("listbox")).toBeTruthy();
    rerender(
      <SelectControl
        aria-label="设备"
        value="normal"
        onChange={change}
        options={options}
        disabled
      />,
    );
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((screen.getByRole("combobox") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("方向键跳过禁用项，Home/End 定位，Enter/Space 选择且不提交表单", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Controlled />
      </form>,
    );
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: "紧急" }).id,
    );
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.getAttribute("data-value")).toBe("urgent");
    fireEvent.keyDown(trigger, { key: " " });
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: " " });
    expect(trigger.getAttribute("data-value")).toBe("");
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "End" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.getAttribute("data-value")).toBe("normal");
    expect(submit).not.toHaveBeenCalled();
  });

  it("Escape 只关闭当前下拉，不触发外层对话框的 document Escape", () => {
    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape);
    render(<Controlled searchable />);
    fireEvent.click(screen.getByRole("combobox"));
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("combobox"));
    expect(parentEscape).not.toHaveBeenCalled();
    document.removeEventListener("keydown", parentEscape);
  });

  it("搜索支持描述、分组和编号，未匹配时给出空态", () => {
    render(
      <Controlled
        searchable
        items={[
          {
            value: "D-01",
            label: "巡查一号",
            group: "余杭区",
            description: "机巢与飞机",
          },
          { value: "D-02", label: "巡查二号", group: "西湖区" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    const search = screen.getByRole("searchbox");
    expect(document.activeElement).toBe(search);
    for (const query of ["余杭", "机巢", "D-01"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      expect(screen.getByRole("option", { name: /巡查一号/ })).toBeTruthy();
    }
    fireEvent.change(search, { target: { value: "不存在的设备" } });
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("未找到匹配选项");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("搜索后可用方向键选择，空格保留为搜索内容", () => {
    render(<Controlled searchable />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const search = screen.getByRole("searchbox");
    const spaceEvent = new KeyboardEvent("keydown", {
      key: " ",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(search, spaceEvent);
    expect(spaceEvent.defaultPrevented).toBe(false);
    fireEvent.change(search, { target: { value: "紧急" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(trigger.getAttribute("data-value")).toBe("urgent");
  });

  it.each([false, true])(
    "搜索弹层 Tab（shift=%s）关闭并将焦点锚点放回表单触发器",
    (shiftKey) => {
      render(<Controlled searchable />);
      const trigger = screen.getByRole("combobox");
      fireEvent.click(trigger);
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(screen.getByRole("searchbox"), event);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    },
  );

  it("外部点击或焦点移走后收起，点击菜单本身仍保持打开", () => {
    render(<Controlled searchable />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("searchbox"));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole("button", { name: "下一项" }));
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    act(() => screen.getByRole("button", { name: "下一项" }).focus());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("长标签完整可读，空列表有明确状态；必填和 hidden 值可由表单读取", () => {
    const label = "重点区域巡查设备和机巢档案 — 设备序列号 AHRXNBM00A0256-M4TD";
    const { rerender } = render(
      <SelectControl
        aria-label="执行设备"
        value="device"
        onChange={vi.fn()}
        options={[{ value: "device", label }]}
        required
        name="deviceId"
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger.getAttribute("title")).toBe(label);
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(
      (document.querySelector('input[name="deviceId"]') as HTMLInputElement)
        .value,
    ).toBe("device");
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: label })).toBeTruthy();
    rerender(
      <SelectControl
        aria-label="执行设备"
        value=""
        onChange={vi.fn()}
        options={[]}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("暂无可选项");
  });

  it("长列表默认提供搜索，视口底部上翻并在滚动/resize 后重新锚定", () => {
    let top = 700;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => ({
        x: 900,
        y: top,
        top,
        left: 900,
        right: 1100,
        bottom: top + 36,
        width: 200,
        height: 36,
        toJSON: () => ({}),
      }));
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 768,
      configurable: true,
    });
    render(
      <SelectControl
        aria-label="设备"
        value="1"
        onChange={vi.fn()}
        options={Array.from({ length: 12 }, (_, index) => ({
          value: String(index),
          label: `设备${index}`,
        }))}
      />,
    );
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("searchbox", { name: "搜索设备" })).toBeTruthy();
    const popup = screen.getByRole("listbox").parentElement!;
    expect(popup.classList.contains("is-above")).toBe(true);
    expect(popup.style.left).toBe("796px");
    expect(popup.style.top).toBe("694px");
    top = 100;
    fireEvent.scroll(window);
    expect(popup.classList.contains("is-above")).toBe(false);
    expect(popup.style.top).toBe("142px");
    top = 200;
    fireEvent.resize(window);
    expect(popup.style.top).toBe("242px");
    rect.mockRestore();
  });
});
