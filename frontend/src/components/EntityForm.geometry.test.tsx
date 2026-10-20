// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityForm } from "./UI";
import type GeometryInput from "./GeometryInput";

const geometry = {
  type: "LineString",
  coordinates: [
    [120, 30, 65],
    [120.1, 30.1, 75],
  ],
};
const context = {
  version: 1 as const,
  buildings: [
    {
      waypointIndex: 1,
      id: "building-id",
      name: "未报高度楼宇",
      heightMeters: null,
      center: [120.1, 30.1] as [number, number],
      source: "OpenStreetMap",
    },
  ],
  flightProfile: {
    reference: "AGL" as const,
    defaultHeightMeters: 120,
    waypointHeightsMeters: [85, 135.25],
  },
};

vi.mock("./GeometryInput", () => ({
  default: (props: ComponentProps<typeof GeometryInput>) => (
    <div>
      <output aria-label="表单几何值">{JSON.stringify(props.value)}</output>
      <output aria-label="表单关联值">{JSON.stringify(props.context)}</output>
      <button
        type="button"
        onClick={() => {
          props.onChange(geometry);
          props.onContextChange?.(context);
        }}
      >
        同时更新几何和关联
      </button>
    </div>
  ),
}));

afterEach(cleanup);

describe("EntityForm 几何与关联数据更新契约", () => {
  it("同一事件中的两个回调均保存，保留表单其他字段及来源元数据", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const initial = {
      name: "原航线名称",
      geometry: {
        type: "LineString",
        coordinates: [
          [119, 29],
          [119.1, 29.1],
        ],
      },
      geometryContext: { version: 1, buildings: [] },
      capabilities: {
        sourceProviderId: "900719925474099312345",
        retained: true,
      },
    };
    render(
      <EntityForm
        fields={[
          { key: "name", label: "资源名称", required: true },
          {
            key: "geometry",
            label: "航线绘制",
            type: "geometry",
            required: true,
            geometryMode: "ROUTE",
          },
        ]}
        initial={initial}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /资源名称/ }), {
      target: { value: "修改后的航线名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "同时更新几何和关联" }));
    expect(
      JSON.parse(screen.getByLabelText("表单几何值").textContent!),
    ).toEqual(geometry);
    expect(
      JSON.parse(screen.getByLabelText("表单关联值").textContent!),
    ).toEqual(context);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        ...initial,
        name: "修改后的航线名称",
        geometry,
        geometryContext: context,
      }),
    );
    expect(initial.name).toBe("原航线名称");
    expect(initial.geometry.coordinates[0]).toEqual([119, 29]);
  });

  it("只改资源名称后保存仍携带既有AGL高度、来源高程、楼宇资料及其他元数据", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const initial = {
      name: "已规划巡检航线",
      geometry,
      geometryContext: context,
      sourceMetadata: {
        providerId: "900719925474099312345",
        heightMeters: 65,
        coordinateReference: "SOURCE_MAP_UNSPECIFIED",
      },
    };
    render(
      <EntityForm
        fields={[
          { key: "name", label: "资源名称", required: true },
          {
            key: "geometry",
            label: "航线绘制",
            type: "geometry",
            required: true,
            geometryMode: "ROUTE",
          },
        ]}
        initial={initial}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(
      JSON.parse(screen.getByLabelText("表单关联值").textContent!),
    ).toEqual(context);
    fireEvent.change(screen.getByRole("textbox", { name: /资源名称/ }), {
      target: { value: "重新命名巡检航线" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        ...initial,
        name: "重新命名巡检航线",
      }),
    );
    expect(context.flightProfile.waypointHeightsMeters).toEqual([85, 135.25]);
    expect(geometry.coordinates).toEqual([
      [120, 30, 65],
      [120.1, 30.1, 75],
    ]);
  });
});
