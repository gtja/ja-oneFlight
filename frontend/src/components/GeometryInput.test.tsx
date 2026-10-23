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
import GeometryInput from "./GeometryInput";
import { EntityForm } from "./UI";
import type FlightMap from "./FlightMap";
import type { MapBuilding } from "./FlightMap";

type MapProps = ComponentProps<typeof FlightMap>;
const map = vi.hoisted(() => ({ current: null as MapProps | null }));
vi.mock("./FlightMap", () => ({
  default: (props: MapProps) => {
    map.current = props;
    return (
      <output aria-label="地图绘制点">
        {JSON.stringify(props.drawing?.points)}
      </output>
    );
  },
}));

const source = {
  type: "LineString",
  coordinates: [
    [120.123456789, 30.987654321, 82.125],
    [120.124, 30.988, 91.375],
  ],
};
const building: MapBuilding = {
  id: "building-900719925474099312345",
  name: "巡检关联楼宇",
  heightMeters: null,
  center: [120.123, 30.987],
  source: "OpenFreeMap / OpenStreetMap",
};
const association = (waypointIndex: number) => ({
  ...building,
  id: `building-${waypointIndex}`,
  waypointIndex,
});
const flightProfile = (
  waypointHeightsMeters = [100, 100],
  defaultHeightMeters = 100,
) => ({
  reference: "AGL" as const,
  defaultHeightMeters,
  waypointHeightsMeters,
});
const mappedPoints = () =>
  JSON.parse(screen.getByLabelText("地图绘制点").textContent || "[]");

afterEach(() => {
  cleanup();
  map.current = null;
});

describe("航线编辑器的真实交互契约", () => {
  it("空域全链路使用边界点文案，地图显示完整内环，保存独立高度且保留来源高程", async () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [120, 30, 42, 7],
          [120.1, 30, 43, 8],
          [120.1, 30.1, 44, 9],
          [120, 30, 42, 7],
        ],
        [
          [120.02, 30.01, 50],
          [120.03, 30.01, 50],
          [120.03, 30.02, 50],
          [120.02, 30.01, 50],
        ],
      ],
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[
          {
            key: "geometry",
            label: "空域边界绘制",
            type: "geometry",
            geometryMode: "AIRSPACE",
            required: true,
          },
        ]}
        initial={{
          geometry: polygon,
          airspaceProfile: {
            reference: "AMSL",
            lowerHeightMeters: -10,
            upperHeightMeters: 90,
          },
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(map.current!.drawing!.innerRings).toEqual([
      polygon.coordinates[1].map(([x, y]) => [x, y]),
    ]);
    expect(screen.queryByRole("button", { name: /选择航点/ })).toBeNull();
    expect(screen.getByRole("button", { name: "选择边界点 1" })).toBeTruthy();
    expect(screen.queryByText("起点")).toBeNull();
    expect(screen.queryByText("终点")).toBeNull();
    act(() => map.current!.drawing!.onMove(0, [119.9, 29.9]));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "高度上限（米）" }),
      { target: { value: "120" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      airspaceProfile: {
        reference: "AMSL",
        lowerHeightMeters: -10,
        upperHeightMeters: 120,
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [119.9, 29.9, 42, 7],
            polygon.coordinates[0][1],
            polygon.coordinates[0][2],
            [119.9, 29.9, 42, 7],
          ],
          polygon.coordinates[1],
        ],
      },
    });
    expect(onSubmit.mock.calls[0][0].geometryContext).not.toHaveProperty(
      "flightProfile",
    );
  });
  it("缺少高度基准时拒绝保存，选定离地基准后才能提交", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <EntityForm
        fields={[
          {
            key: "geometry",
            label: "空域边界",
            type: "geometry",
            geometryMode: "AIRSPACE",
          },
        ]}
        initial={{
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [120, 30],
                [121, 30],
                [121, 31],
                [120, 30],
              ],
            ],
          },
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "高度上限（米）" }),
      { target: { value: "120" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        screen.getAllByText("填写空域高度时请选择离地或海拔基准").length,
      ).toBeGreaterThan(0),
    );
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "高度基准" }));
    fireEvent.click(screen.getByRole("option", { name: "离地高度（AGL）" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].airspaceProfile).toEqual({
      reference: "AGL",
      lowerHeightMeters: null,
      upperHeightMeters: 120,
    });
  });
  it("空间辅助开关只影响视图，跨全屏返回保留且不改航点或规划高度", () => {
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={source}
        mode="ROUTE"
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    const initialContext = onContextChange.mock.calls.at(-1)?.[0];
    expect(map.current!.drawing!.showGroundProjection).toBe(true);
    expect(map.current!.drawing!.showCurtain).toBe(true);
    expect(map.current!.drawing!.showHeightLabels).toBe(true);
    fireEvent.click(screen.getByText("空间辅助"));
    for (const name of ["地面投影", "高度幕帘", "高度标注"])
      fireEvent.click(screen.getByRole("button", { name }));
    expect(map.current!.drawing!.showGroundProjection).toBe(false);
    expect(map.current!.drawing!.showCurtain).toBe(false);
    expect(map.current!.drawing!.showHeightLabels).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "完成绘制" }));
    expect(map.current!.drawing!.showCurtain).toBe(false);
    expect(map.current!.drawing!.heightMeters).toEqual([100, 100]);
    expect(onChange).not.toHaveBeenCalled();
    expect(onContextChange).toHaveBeenCalledTimes(1);
    expect(onContextChange.mock.calls[0][0]).toEqual(initialContext);
    expect(source.coordinates[0][2]).toBe(82.125);
  });
  it("地图拖动改变经纬度，保留源高程、精度与其他航点", () => {
    const onChange = vi.fn();
    render(
      <GeometryInput
        value={JSON.stringify(source)}
        mode="ROUTE"
        onChange={onChange}
      />,
    );
    expect(mappedPoints()).toEqual(
      source.coordinates.map(([longitude, latitude]) => [longitude, latitude]),
    );
    act(() => map.current!.drawing!.onMove(1, [120.555123456, 30.888123456]));
    expect(onChange).toHaveBeenLastCalledWith({
      type: "LineString",
      coordinates: [
        source.coordinates[0],
        [120.555123456, 30.888123456, 91.375],
      ],
    });
    expect(source.coordinates[1]).toEqual([120.124, 30.988, 91.375]);
    expect(screen.getAllByText("含来源高程")).toHaveLength(2);
    expect(map.current!.drawing!.selectedIndex).toBe(1);
  });

  it("编辑源 Polygon 外环时保持内环及闭合点高程", () => {
    const polygon = {
      type: "Polygon",
      coordinates: [
        [
          [120, 30, 40],
          [121, 30, 50],
          [121, 31, 60],
          [120, 30, 40],
        ],
        [
          [120.5, 30.2, 70],
          [120.6, 30.2, 70],
          [120.6, 30.3, 70],
          [120.5, 30.2, 70],
        ],
      ],
    };
    const onChange = vi.fn();
    render(
      <GeometryInput
        value={JSON.stringify(polygon)}
        mode="AIRSPACE"
        onChange={onChange}
      />,
    );
    expect(mappedPoints()).toHaveLength(3);
    act(() => map.current!.drawing!.onMove(0, [119.9, 29.9]));
    expect(onChange).toHaveBeenLastCalledWith({
      type: "Polygon",
      coordinates: [
        [
          [119.9, 29.9, 40],
          [121, 30, 50],
          [121, 31, 60],
          [119.9, 29.9, 40],
        ],
        polygon.coordinates[1],
      ],
    });
    expect(polygon.coordinates[0][0]).toEqual([120, 30, 40]);
  });

  it("查看楼宇不会新增航点，关联资料保持未知高度并单独写 context", () => {
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={source}
        mode="ROUTE"
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "查看楼宇" }));
    expect(map.current!.drawing!.interaction).toBe("inspect");
    act(() => {
      map.current!.onBuildingSelect!(building);
      map.current!.onMapPoint!([120.123, 30.987]);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(mappedPoints()).toHaveLength(2);
    expect(screen.getByText("来源未提供")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关联到航点 1" }));
    expect(onContextChange).toHaveBeenLastCalledWith({
      version: 1,
      buildings: [{ ...building, waypointIndex: 0 }],
      flightProfile: flightProfile(),
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(map.current!.selectedBuildingId).toBe(building.id);
  });

  it("删除中间航点移除其关联，后续楼宇索引与高程同步前移", () => {
    const route = {
      type: "LineString",
      coordinates: [...source.coordinates, [120.125, 30.989, 100.5]],
    };
    const context = {
      version: 1,
      buildings: [association(0), association(1), association(2)],
      flightProfile: flightProfile([60, 90, 150], 90),
    };
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={route}
        context={context}
        mode="ROUTE"
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "选择航点 2" }));
    fireEvent.click(screen.getByRole("button", { name: "删除航点 2" }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: "LineString",
      coordinates: [route.coordinates[0], route.coordinates[2]],
    });
    expect(onContextChange).toHaveBeenLastCalledWith({
      version: 1,
      buildings: [association(0), { ...association(2), waypointIndex: 1 }],
      flightProfile: flightProfile([60, 150], 90),
    });
    expect(context.buildings.map((item) => item.waypointIndex)).toEqual([
      0, 1, 2,
    ]);
    expect(mappedPoints()).toHaveLength(2);
    expect(map.current!.drawing!.selectedIndex).toBe(1);
    expect(map.current!.drawing!.heightMeters).toEqual([60, 150]);
    expect(context.flightProfile.waypointHeightsMeters).toEqual([60, 90, 150]);
  });

  it("表单全屏编辑及各返回入口不提交，来回切换保留本次点位和楼宇关联", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const initial = {
      name: "巡查航线",
      geometry: source,
      sourceMetadata: { providerId: "long-id-900719925474099312345" },
    };
    render(
      <EntityForm
        fields={[
          { key: "name", label: "资源名称", required: true },
          {
            key: "geometry",
            label: "航线绘制",
            type: "geometry",
            geometryMode: "ROUTE",
            required: true,
          },
        ]}
        initial={initial}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    act(() => map.current!.onMapPoint!([120.126, 30.99]));
    fireEvent.change(screen.getByRole("spinbutton", { name: "统一规划高度" }), {
      target: { value: "135" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用全部" }));
    fireEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    expect(screen.getByRole("dialog", { name: "航线编辑器" })).toBeTruthy();
    expect(mappedPoints()).toHaveLength(3);
    act(() => map.current!.onMapPoint!([120.127, 30.991]));
    fireEvent.change(screen.getByRole("spinbutton", { name: "航点规划高度" }), {
      target: { value: "175.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查看楼宇" }));
    act(() => map.current!.onBuildingSelect!(building));
    fireEvent.click(screen.getByRole("button", { name: "关联到航点 4" }));
    fireEvent.click(screen.getByRole("button", { name: "返回资源表单" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mappedPoints()).toHaveLength(4);
    expect(map.current!.drawing!.heightMeters).toEqual([135, 135, 135, 175.25]);
    fireEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "完成绘制" }));
    expect(mappedPoints()).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "全屏编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(mappedPoints()).toHaveLength(4);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith({
      ...initial,
      geometry: {
        type: "LineString",
        coordinates: [
          ...source.coordinates,
          [120.126, 30.99],
          [120.127, 30.991],
        ],
      },
      geometryContext: {
        version: 1,
        buildings: [{ ...building, waypointIndex: 3 }],
        flightProfile: flightProfile([135, 135, 135, 175.25], 135),
      },
    });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("立体航线高度交互与持久化契约", () => {
  it("旧来源航线只初始化本地100米AGL草稿，不把来源Z套成规划高度或触发几何保存", () => {
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={source}
        mode="ROUTE"
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    expect(map.current!.drawing!.heightMeters).toEqual([100, 100]);
    expect(onContextChange).toHaveBeenCalledOnce();
    expect(onContextChange).toHaveBeenLastCalledWith({
      version: 1,
      buildings: [],
      flightProfile: flightProfile(),
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", { name: "航点规划高度" })
        .value,
    ).toBe("100");
    expect(screen.getByText(/来源高度：82\.125/)).toBeTruthy();
    expect(screen.getByText(/基准未说明，保留原值/)).toBeTruthy();
    expect(source.coordinates[0]).toEqual([
      120.123456789, 30.987654321, 82.125,
    ]);
  });

  it("编辑选中点高度即时更新立体地图，零米合法且拖点保持规划值和来源Z", () => {
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={source}
        mode="ROUTE"
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "航点规划高度" }), {
      target: { value: "0" },
    });
    expect(map.current!.drawing!.heightMeters).toEqual([0, 100]);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "选择航点 2" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "航点规划高度" }), {
      target: { value: "146.75" },
    });
    expect(map.current!.drawing!.heightMeters).toEqual([0, 146.75]);
    act(() => map.current!.drawing!.onMove(1, [120.555, 30.888]));
    expect(map.current!.drawing!.heightMeters).toEqual([0, 146.75]);
    expect(onContextChange).toHaveBeenLastCalledWith({
      version: 1,
      buildings: [],
      flightProfile: flightProfile([0, 146.75]),
    });
    expect(onChange).toHaveBeenLastCalledWith({
      type: "LineString",
      coordinates: [source.coordinates[0], [120.555, 30.888, 91.375]],
    });
  });

  it("统一高度经应用全部后更新现有点和新增点默认，未应用草稿不改变地图", () => {
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={source}
        mode="ROUTE"
        onChange={vi.fn()}
        onContextChange={onContextChange}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "统一规划高度" }), {
      target: { value: "180.5" },
    });
    expect(map.current!.drawing!.heightMeters).toEqual([100, 100]);
    fireEvent.click(screen.getByRole("button", { name: "应用全部" }));
    expect(map.current!.drawing!.heightMeters).toEqual([180.5, 180.5]);
    act(() => map.current!.onMapPoint!([120.126, 30.99]));
    expect(map.current!.drawing!.heightMeters).toEqual([180.5, 180.5, 180.5]);
    expect(onContextChange).toHaveBeenLastCalledWith({
      version: 1,
      buildings: [],
      flightProfile: flightProfile([180.5, 180.5, 180.5], 180.5),
    });
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", { name: "航点规划高度" })
        .value,
    ).toBe("180.5");
  });

  it("高度非法值显示校验信息，保留原规划和来源几何；修正后可继续编辑", () => {
    const onChange = vi.fn();
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={source}
        mode="ROUTE"
        onChange={onChange}
        onContextChange={onContextChange}
      />,
    );
    onContextChange.mockClear();
    for (const raw of ["-1", "10001", ""]) {
      fireEvent.change(
        screen.getByRole("spinbutton", { name: "航点规划高度" }),
        {
          target: { value: raw },
        },
      );
      expect(screen.getByRole("alert").textContent).toContain("0～10000");
      expect(map.current!.drawing!.heightMeters).toEqual([100, 100]);
      expect(onContextChange).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    }
    fireEvent.change(screen.getByRole("spinbutton", { name: "航点规划高度" }), {
      target: { value: "75" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(map.current!.drawing!.heightMeters).toEqual([75, 100]);
    expect(source.coordinates[0][2]).toBe(82.125);
  });

  it("重开保存的AGL规划用于地图，关联及解除楼宇保持高度和真实轮廓", () => {
    const onContextChange = vi.fn();
    const outline: [number, number][] = [
      [120.123, 30.987],
      [120.124, 30.987],
      [120.124, 30.988],
      [120.123, 30.987],
    ];
    const context = {
      version: 1,
      buildings: [],
      flightProfile: flightProfile([45, 95], 80),
    };
    render(
      <GeometryInput
        value={source}
        context={context}
        mode="ROUTE"
        onChange={vi.fn()}
        onContextChange={onContextChange}
      />,
    );
    expect(map.current!.drawing!.heightMeters).toEqual([45, 95]);
    expect(
      screen.getByRole<HTMLInputElement>("spinbutton", { name: "统一规划高度" })
        .value,
    ).toBe("80");
    fireEvent.click(screen.getByRole("button", { name: "查看楼宇" }));
    act(() => map.current!.onBuildingSelect!({ ...building, outline }));
    fireEvent.click(screen.getByRole("button", { name: "关联到航点 1" }));
    expect(onContextChange).toHaveBeenLastCalledWith({
      ...context,
      buildings: [{ ...building, outline, waypointIndex: 0 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "解除" }));
    expect(onContextChange).toHaveBeenLastCalledWith(context);
    expect(map.current!.drawing!.heightMeters).toEqual([45, 95]);
  });

  it("地形未就绪明确显示基面预览，地图地形完成回调后取消提示", () => {
    render(<GeometryInput value={source} mode="ROUTE" onChange={vi.fn()} />);
    expect(screen.getByText(/部分地形未就绪，按零高程基面预览/)).toBeTruthy();
    act(() => map.current!.drawing!.onTerrainStatus!({ known: 2, total: 2 }));
    expect(screen.queryByText(/部分地形未就绪，按零高程基面预览/)).toBeNull();
    act(() => map.current!.drawing!.onTerrainStatus!({ known: 1, total: 2 }));
    expect(screen.getByText(/部分地形未就绪，按零高程基面预览/)).toBeTruthy();
  });

  it("空域保持原有边界编辑，既不初始化航线高度也不出现规划高度控件", () => {
    const onContextChange = vi.fn();
    render(
      <GeometryInput
        value={{
          type: "Polygon",
          coordinates: [
            [
              [120, 30, 50],
              [120.01, 30, 50],
              [120.01, 30.01, 50],
              [120, 30, 50],
            ],
          ],
        }}
        mode="AIRSPACE"
        onChange={vi.fn()}
        onContextChange={onContextChange}
      />,
    );
    expect(map.current!.drawing!.heightMeters).toBeUndefined();
    expect(
      screen.queryByRole("spinbutton", { name: "统一规划高度" }),
    ).toBeNull();
    expect(
      screen.queryByRole("spinbutton", { name: "航点规划高度" }),
    ).toBeNull();
    expect(onContextChange).not.toHaveBeenCalled();
  });
});
