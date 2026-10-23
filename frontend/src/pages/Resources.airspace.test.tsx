// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Entity } from "../api";
import { FeedbackContext, UserContext } from "../context";
import type FlightMap from "../components/FlightMap";
import Resources from "./Resources";

const maps = vi.hoisted(() => ({
  drawing: null as ComponentProps<typeof FlightMap>["drawing"] | null,
}));
vi.mock("../components/FlightMap", () => ({
  default: (props: ComponentProps<typeof FlightMap>) => {
    if (props.drawing) maps.drawing = props.drawing;
    return (
      <output
        aria-label="合成空域地图"
        data-projection={
          props.initialThreeD === false ? "planar" : "perspective"
        }
      >
        {JSON.stringify(props.drawing?.points || props.objects)}
      </output>
    );
  },
}));
const profile = {
  reference: "AGL",
  lowerHeightMeters: 0,
  upperHeightMeters: 120,
};
const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [120, 30, 42, 7],
      [120.01, 30, 43, 8],
      [120.01, 30.01, 44, 9],
      [120, 30, 42, 7],
    ],
    [
      [120.005, 30.001, 50],
      [120.006, 30.001, 50],
      [120.006, 30.002, 50],
      [120.005, 30.001, 50],
    ],
  ],
};
const user: CurrentUser = {
  id: "synthetic-admin",
  username: "synthetic",
  displayName: "合成管理员",
  role: "ADMIN",
  organizationId: "org-1",
  regions: [],
  deviceIds: [],
};
const page = (items: Entity[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});
const response = (data: unknown) =>
  new Response(JSON.stringify({ code: "SUCCESS", data }), {
    headers: { "Content-Type": "application/json" },
  });
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  maps.drawing = null;
  vi.unstubAllGlobals();
});
function setup(role = user.role) {
  let imported = false;
  const saved: Record<string, unknown>[] = [];
  const archive = {
    id: "imported-airspace",
    kind: "AIRSPACE",
    title: "导入的合成空域",
    organizationId: "org-1",
    region: "西湖区",
    status: "PENDING_CONFIRMATION",
    metadata: {
      geometry,
      airspaceProfile: profile,
      coordinateReference: "WGS84",
      description: "合成导入说明",
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      if (url.pathname.endsWith("/auth/csrf"))
        return response({
          token: "synthetic-token",
          headerName: "X-CSRF-TOKEN",
        });
      if (url.pathname.endsWith("/organizations"))
        return response(page([{ id: "org-1", title: "合成组织" }]));
      if (url.pathname.endsWith("/airspace-imports/preview"))
        return response({
          batchId: "batch-1",
          canCommit: true,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          summary: {
            total: 1,
            valid: 1,
            invalid: 0,
            duplicates: 0,
            pointCount: 8,
          },
          rows: [
            {
              index: 1,
              title: archive.title,
              model: null,
              description: null,
              geometry,
              airspaceProfile: profile,
              pointCount: 8,
              duplicate: false,
              errors: [],
              warnings: [],
            },
          ],
        });
      if (url.pathname.endsWith("/airspace-imports/batch-1/commit")) {
        imported = true;
        return response({
          batchId: "batch-1",
          status: "COMMITTED",
          imported: 1,
          skipped: 0,
          ids: [archive.id],
          importedAt: new Date().toISOString(),
        });
      }
      if (
        url.pathname.endsWith(`/resources/${archive.id}`) &&
        options?.method === "PUT"
      ) {
        const body = JSON.parse(String(options.body));
        saved.push(body);
        return response({ ...archive, ...body });
      }
      if (url.pathname.endsWith("/resources"))
        return response(
          page(
            imported && url.searchParams.get("kind") === "AIRSPACE"
              ? [archive]
              : [],
          ),
        );
      return response(page([]));
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const feedback = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <UserContext.Provider value={{ ...user, role }}>
        <FeedbackContext.Provider value={feedback}>
          <Resources />
        </FeedbackContext.Provider>
      </UserContext.Provider>
    </QueryClientProvider>,
  );
  return { saved, feedback };
}

describe("空域导入与资源编辑衔接", () => {
  it("导入后刷新本地档案，编辑保存metadata高度且完整保留内环和来源额外维度", async () => {
    const { saved, feedback } = setup();
    fireEvent.click(screen.getByRole("button", { name: "空域资源" }));
    fireEvent.click(screen.getByRole("button", { name: "本地业务档案" }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    fireEvent.click(screen.getByRole("button", { name: "批量导入" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "业务所属组织" }).textContent,
      ).toContain("合成组织"),
    );
    fireEvent.change(screen.getByLabelText("GeoJSON 文件"), {
      target: {
        files: [new File([JSON.stringify(geometry)], "synthetic.geojson")],
      },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "所属区域" }));
    fireEvent.click(screen.getByRole("option", { name: "西湖区" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: /确认文件使用 WGS84/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await screen.findByText("1. 导入的合成空域");
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "批量导入空域" })).toBeNull(),
    );
    expect(feedback).toHaveBeenCalledWith("空域导入完成：新增 1 条，跳过 0 条");
    fireEvent.click(
      await screen.findByText("导入的合成空域", { selector: "strong" }),
    );
    expect(
      screen.getByLabelText("合成空域地图").getAttribute("data-projection"),
    ).toBe("planar");
    fireEvent.click(screen.getByRole("button", { name: "编辑档案" }));
    expect(maps.drawing?.innerRings).toEqual([
      geometry.coordinates[1].map(([x, y]) => [x, y]),
    ]);
    act(() => maps.drawing!.onMove(1, [120.02, 30]));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "高度上限（米）" }),
      { target: { value: "150" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).not.toHaveProperty("airspaceProfile");
    expect(saved[0]).not.toHaveProperty("geometry");
    expect(saved[0].metadata).toMatchObject({
      airspaceProfile: { ...profile, upperHeightMeters: 150 },
      coordinateReference: "WGS84",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            geometry.coordinates[0][0],
            [120.02, 30, 43, 8],
            geometry.coordinates[0][2],
            geometry.coordinates[0][3],
          ],
          geometry.coordinates[1],
        ],
      },
    });
    expect(
      (saved[0].metadata as Record<string, unknown>).geometryContext,
    ).not.toHaveProperty("flightProfile");
  });
  it("部门用户没有批量导入入口", async () => {
    setup("DEPARTMENT");
    fireEvent.click(screen.getByRole("button", { name: "空域资源" }));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.queryByRole("button", { name: "批量导入" })).toBeNull();
  });
});
