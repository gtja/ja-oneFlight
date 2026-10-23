// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { airspaceShapePoints, inferAirspaceShape } from "../airspaceShapes";
import {
  drawGeometry,
  geometryPositions,
  routeLengthMeters,
  type GeometryPosition,
} from "../geometry";
import GeometryInput from "./GeometryInput";
import type FlightMap from "./FlightMap";
import { EntityForm } from "./UI";

type MapProps = ComponentProps<typeof FlightMap>;
const map = vi.hoisted(() => ({ current: null as MapProps | null }));
vi.mock("./FlightMap", () => ({
  default: (props: MapProps) => {
    map.current = props;
    return (
      <output aria-label="空域绘图预览">
        {JSON.stringify(props.drawing?.points)}
      </output>
    );
  },
}));
afterEach(() => {
  cleanup();
  map.current = null;
});
const circle = {
  type: "CIRCLE" as const,
  center: [120, 30] as [number, number],
  radiusMeters: 500,
};
const rectangle = {
  type: "RECTANGLE" as const,
  west: 120,
  south: 30,
  east: 120.01,
  north: 30.02,
};
const polygon = (points: GeometryPosition[]) =>
  drawGeometry(points, "AIRSPACE")!;
const field = {
  key: "geometry",
  label: "空域边界",
  type: "geometry" as const,
  geometryMode: "AIRSPACE" as const,
  required: true,
};
const changeNumber = (name: string, value: string) => {
  const input = screen.getByRole("spinbutton", { name });
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("空域形状编辑", () => {
  it("识别历史圆形但打开及单独改高度不重建原坐标", async () => {
    const original = polygon(
      airspaceShapePoints(circle).map(
        (point, index) => [...point, 40 + index, 7] as GeometryPosition,
      ),
    );
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[field]}
        initial={{ geometry: original }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "圆形" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(map.current?.drawing?.controls?.map((item) => item.label)).toEqual([
      "圆心",
      "半径",
    ]);
    expect(map.current?.initialThreeD).toBe(false);
    fireEvent.click(screen.getByRole("combobox", { name: "高度基准" }));
    fireEvent.click(screen.getByRole("option", { name: "离地高度（AGL）" }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "高度上限（米）" }),
      { target: { value: "120" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].geometry).toEqual(original);
  });

  it("调半径、拖圆心及跨全屏仍保持圆形、来源维度和内环，参数随保存提交", async () => {
    const points = airspaceShapePoints(circle).map(
      (point, index) => [...point, 42 + index, index] as GeometryPosition,
    );
    const hole = [
      [119.9999, 29.9999, 80],
      [120.0001, 29.9999, 81],
      [120, 30.0001, 82],
      [119.9999, 29.9999, 80],
    ];
    const original = {
      ...polygon(points),
      coordinates: [
        (polygon(points) as { coordinates: number[][][] }).coordinates[0],
        hole,
      ],
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[field]}
        initial={{ geometry: original }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    changeNumber("半径（米）", "800");
    act(() => map.current!.drawing!.onMove(0, [120.001, 30.001]));
    fireEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    expect(
      Number(
        (
          screen.getByRole("spinbutton", {
            name: "半径（米）",
          }) as HTMLInputElement
        ).value,
      ),
    ).toBe(800);
    expect(map.current!.drawing!.controls).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "完成绘制" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const saved = onSubmit.mock.calls[0][0];
    expect(saved.geometryContext.airspaceShape).toEqual({
      ...circle,
      center: [120.001, 30.001],
      radiusMeters: 800,
    });
    expect(saved.geometry.coordinates[1]).toEqual(hole);
    expect(saved.geometry.coordinates[0]).toHaveLength(points.length + 1);
    expect(
      saved.geometry.coordinates[0]
        .slice(0, -1)
        .map((point: number[]) => point.slice(2)),
    ).toEqual(points.map((point) => point.slice(2)));
    for (const point of geometryPositions(saved.geometry, "AIRSPACE")) {
      expect(routeLengthMeters([[120.001, 30.001], point])).toBeCloseTo(800, 5);
    }
    expect(saved.geometryContext).not.toHaveProperty("flightProfile");
  });

  it("两次单击绘制圆或矩形，拒绝重合点；清空后必须重新完成范围", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[field]}
        initial={{}}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "圆形" }));
    act(() => map.current!.onMapPoint!([120, 30]));
    expect(map.current!.drawing!.controls).toEqual([
      { point: [120, 30], label: "圆心" },
    ]);
    act(() => map.current!.onMapPoint!([120, 30]));
    expect(screen.getByRole("alert").textContent).toContain("有效范围");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByText("请先绘制空域边界");
    expect(onSubmit).not.toHaveBeenCalled();
    act(() => map.current!.onMapPoint!([120.01, 30]));
    expect(map.current!.drawing!.points).toHaveLength(64);
    fireEvent.click(screen.getByRole("button", { name: "清空" }));
    expect(map.current!.drawing!.points).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "矩形" }));
    act(() => map.current!.onMapPoint!([120.02, 30.03]));
    act(() => map.current!.onMapPoint!([120, 30]));
    expect(map.current!.drawing!.points).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].geometry.coordinates[0]).toEqual([
      [120, 30],
      [120.02, 30],
      [120.02, 30.03],
      [120, 30.03],
      [120, 30],
    ]);
  });

  it("已有矩形按对角点和数值调整，设正方形后保留四角维度，切回多边形才逐点编辑", () => {
    const points = airspaceShapePoints(rectangle).map(
      (point, index) => [...point, index + 80] as GeometryPosition,
    );
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        mode="AIRSPACE"
        value={polygon(points)}
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    expect(
      screen.getByRole("button", { name: "矩形" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
    act(() => map.current!.drawing!.onMove(1, [120.02, 30.03]));
    changeNumber("西侧经度", "119.99");
    fireEvent.click(screen.getByRole("button", { name: "设为正方形" }));
    const saved = onChange.mock.calls.at(-1)![0];
    const next = inferAirspaceShape(geometryPositions(saved, "AIRSPACE"));
    expect(next?.type).toBe("RECTANGLE");
    if (next?.type !== "RECTANGLE") throw new Error("Expected rectangle");
    expect(
      routeLengthMeters([
        [next.west, next.south],
        [next.east, next.south],
      ]),
    ).toBeCloseTo(
      routeLengthMeters([
        [next.west, next.south],
        [next.west, next.north],
      ]),
      5,
    );
    expect(saved.coordinates[0].map((point: number[]) => point[2])).toEqual([
      80, 81, 82, 83, 80,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "多边形" }));
    expect(screen.getByRole("button", { name: "选择边界点 1" })).toBeTruthy();
    expect(onContextChange.mock.calls.at(-1)![0]).not.toHaveProperty(
      "airspaceShape",
    );
    act(() => map.current!.drawing!.onMove(0, [119.98, 30]));
    expect(onChange.mock.calls.at(-1)![0].coordinates[0][0]).toEqual([
      119.98, 30, 80,
    ]);
  });

  it("过期形状参数不能覆盖已改成普通多边形的权威几何", () => {
    const original = polygon([
      [120, 30, 40],
      [120.01, 30, 41],
      [120.02, 30.02, 42],
    ]);
    const onChange = vi.fn();
    render(
      <GeometryInput
        mode="AIRSPACE"
        value={original}
        context={{ version: 1, buildings: [], airspaceShape: circle }}
        onChange={onChange}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "多边形" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(map.current!.drawing!.points).toHaveLength(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("半途重新绘制重置首个位置，下次点击重新选择圆心", () => {
    const onChange = vi.fn();
    render(<GeometryInput mode="AIRSPACE" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "圆形" }));
    act(() => map.current!.onMapPoint!([120, 30]));
    fireEvent.click(screen.getByRole("button", { name: "重新绘制" }));
    act(() => map.current!.onMapPoint!([121, 31]));
    expect(map.current!.drawing!.controls).toEqual([
      { point: [121, 31], label: "圆心" },
    ]);
    expect(onChange).toHaveBeenLastCalledWith(null);
    act(() => map.current!.onMapPoint!([121.01, 31]));
    expect(map.current!.drawing!.controls![0].point).toEqual([121, 31]);
    expect(map.current!.drawing!.points).toHaveLength(64);
  });
});
