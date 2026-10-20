// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HourlyChart, RegionalChart } from "./CommandTaskCharts";

afterEach(cleanup);

const hours = Array.from({ length: 24 }, (_, index) => (index === 12 ? 3 : 0));
const regions = [
  { region: "余杭区", count: 3 },
  { region: "西湖区", count: 0 },
];

describe("大屏时段图交互", () => {
  it("零值时段通过整列命中区查看明细，并显示悬停提示", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <HourlyChart values={hours} onSelect={onSelect} />,
    );
    const chart = screen.getByRole("group", {
      name: "今日任务按计划开始时间分布",
    });
    expect(within(chart).getAllByRole("button")).toHaveLength(24);
    const midnight = within(chart).getByRole("button", {
      name: "00:00 · 0 项任务，查看明细",
    });
    const hit = midnight.querySelector(".command-task-chart-hit")!;
    expect(Number(hit.getAttribute("height"))).toBeGreaterThan(100);
    fireEvent.mouseEnter(midnight);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("00:00–00:59");
    expect(tooltip.textContent).toContain("0 项任务");
    expect(tooltip.textContent).toContain("点击查看明细");
    expect(midnight.getAttribute("aria-describedby")).toBe(tooltip.id);
    fireEvent.click(hit);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(0);
    fireEvent.mouseLeave(midnight);
    expect(screen.queryByRole("tooltip")).toBeNull();
    rerender(<HourlyChart values={hours} onSelect={onSelect} activeHour={0} />);
    expect(midnight.getAttribute("aria-pressed")).toBe("true");
  });

  it("键盘聚焦显示提示，Enter 和 Space 选择且 Escape 关闭提示", () => {
    const onSelect = vi.fn();
    render(<HourlyChart values={hours} onSelect={onSelect} />);
    const noon = screen.getByRole("button", {
      name: "12:00 · 3 项任务，查看明细",
    });
    fireEvent.focus(noon);
    expect(screen.getByRole("tooltip").textContent).toContain("12:00–12:59");
    fireEvent.keyDown(noon, { key: "Enter" });
    fireEvent.keyDown(noon, { key: " " });
    fireEvent.keyDown(noon, { key: " ", repeat: true });
    expect(onSelect.mock.calls).toEqual([[12], [12]]);
    fireEvent.keyDown(noon, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.blur(noon);
    fireEvent.focus(noon);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("左右方向键及 Home、End 能在小时之间移动焦点", () => {
    render(<HourlyChart values={hours} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.keyDown(buttons[12], { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[13]);
    fireEvent.keyDown(buttons[13], { key: "ArrowLeft" });
    expect(document.activeElement).toBe(buttons[12]);
    fireEvent.keyDown(buttons[12], { key: "End" });
    expect(document.activeElement).toBe(buttons[23]);
    fireEvent.keyDown(buttons[23], { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("数据缺失和空数组显示不同状态，均没有可交互时段", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <HourlyChart values={null} onSelect={onSelect} />,
    );
    expect(screen.getByText("任务数据暂不可用")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    rerender(<HourlyChart values={[]} onSelect={onSelect} />);
    expect(screen.getByText("今日暂无任务数据")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("大屏区域图交互", () => {
  it("零值区域可点击、可用键盘选择，且正确显示选中状态", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <RegionalChart items={regions} onSelect={onSelect} />,
    );
    const westLake = screen.getByRole("button", {
      name: "西湖区 · 0 项任务，查看明细",
    });
    fireEvent.mouseEnter(westLake);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "西湖区0 项任务点击查看明细 →",
    );
    fireEvent.click(westLake.querySelector(".command-task-chart-hit")!);
    fireEvent.keyDown(westLake, { key: "Enter" });
    fireEvent.keyDown(westLake, { key: " " });
    expect(onSelect.mock.calls).toEqual([["西湖区"], ["西湖区"], ["西湖区"]]);
    rerender(
      <RegionalChart
        items={regions}
        onSelect={onSelect}
        activeRegion="西湖区"
      />,
    );
    expect(westLake.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: /余杭区/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("聚焦的提示在鼠标移出后保留，失焦后关闭", () => {
    render(<RegionalChart items={regions} onSelect={vi.fn()} />);
    const target = screen.getByRole("button", { name: /余杭区/ });
    fireEvent.focus(target);
    fireEvent.mouseEnter(target);
    fireEvent.mouseLeave(target);
    expect(screen.getByRole("tooltip").textContent).toContain("余杭区");
    fireEvent.blur(target);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("空数据移除交互和旧提示，区分无任务与数据不可用", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <RegionalChart items={regions} onSelect={onSelect} />,
    );
    fireEvent.mouseEnter(screen.getByRole("button", { name: /西湖区/ }));
    rerender(<RegionalChart items={null} onSelect={onSelect} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText("任务数据暂不可用")).toBeTruthy();
    rerender(<RegionalChart items={[]} onSelect={onSelect} />);
    expect(screen.getByText("今日暂无区域任务数据")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
