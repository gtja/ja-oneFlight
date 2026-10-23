// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AirspaceImport from "./AirspaceImport";
import type { AirspaceImportPreview } from "../../api/types";

vi.mock("../../components/FlightMap", () => ({
  default: (props: { objects?: unknown[]; initialThreeD?: boolean }) => (
    <output
      aria-label="范围地图"
      data-projection={props.initialThreeD === false ? "planar" : "perspective"}
    >
      {JSON.stringify(props.objects)}
    </output>
  ),
}));

const polygon: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [120, 30, 40],
      [120.01, 30, 50],
      [120.01, 30.01, 60],
      [120, 30, 40],
    ],
    [
      [120.005, 30.001, 10],
      [120.006, 30.001, 10],
      [120.006, 30.002, 10],
      [120.005, 30.001, 10],
    ],
  ],
};
const preview: AirspaceImportPreview = {
  batchId: "batch-1",
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  canCommit: true,
  summary: { total: 1, valid: 1, invalid: 0, duplicates: 0, pointCount: 8 },
  rows: [
    {
      index: 1,
      title: "合成空域",
      model: null,
      description: null,
      geometry: polygon,
      airspaceProfile: null,
      pointCount: 8,
      duplicate: false,
      errors: [],
      warnings: [
        { code: "HEIGHT_UNSPECIFIED", message: "高度未明确，请后续核验" },
      ],
    },
  ],
};
const result = {
  batchId: "batch-1",
  status: "COMMITTED",
  imported: 1,
  skipped: 0,
  ids: ["resource-1"],
  importedAt: new Date().toISOString(),
};
const response = (
  data: unknown,
  status = 200,
  code = "SUCCESS",
  message = "成功",
) =>
  new Response(JSON.stringify({ code, message, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(
  options: { report?: AirspaceImportPreview; commits?: Response[] } = {},
) {
  const calls: { path: string; options?: RequestInit }[] = [];
  const commits = [...(options.commits || [])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, request?: RequestInit) => {
      calls.push({ path, options: request });
      if (path === "/api/v1/auth/csrf")
        return response({
          token: "synthetic-token",
          headerName: "X-CSRF-TOKEN",
        });
      if (path.endsWith("/preview")) return response(options.report || preview);
      if (path.endsWith("/commit")) return commits.shift() || response(result);
      return response(null, 404);
    }),
  );
  const onClose = vi.fn();
  const onImported = vi.fn().mockResolvedValue(undefined);
  render(
    <AirspaceImport
      organizations={[{ id: "org-1", title: "合成组织" }]}
      organizationId="org-1"
      onClose={onClose}
      onImported={onImported}
    />,
  );
  return { calls, onClose, onImported };
}
function chooseFile(name = "synthetic.geojson") {
  fireEvent.change(screen.getByLabelText("GeoJSON 文件"), {
    target: {
      files: [
        new File(
          [
            JSON.stringify({
              type: "Polygon",
              coordinates: polygon.coordinates,
            }),
          ],
          name,
          { type: "application/geo+json" },
        ),
      ],
    },
  });
}
function chooseRegion() {
  fireEvent.click(screen.getByRole("combobox", { name: "所属区域" }));
  fireEvent.click(screen.getByRole("option", { name: "西湖区" }));
}
async function validate() {
  chooseFile();
  chooseRegion();
  fireEvent.click(screen.getByRole("checkbox", { name: /确认文件使用 WGS84/ }));
  fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
  await screen.findByText("1. 合成空域");
}

describe("空域文件导入", () => {
  it("先确认坐标和归属，预览发送 multipart 与 CSRF，保留内环及来源高程", async () => {
    const { calls, onImported } = setup();
    chooseFile();
    chooseRegion();
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    expect(
      await screen.findByText("请确认文件坐标为 WGS84 经纬度"),
    ).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /确认文件使用 WGS84/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await screen.findByText("1. 合成空域");
    const request = calls.find((call) => call.path.endsWith("/preview"))!;
    expect(request.options?.body).toBeInstanceOf(FormData);
    expect(new Headers(request.options?.headers).get("X-CSRF-TOKEN")).toBe(
      "synthetic-token",
    );
    const body = request.options?.body as FormData;
    expect(body.get("file")).toBeInstanceOf(File);
    const options = body.get("options") as Blob;
    expect(options.type).toBe("application/json");
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(options);
    });
    expect(JSON.parse(text)).toEqual({
      organizationId: "org-1",
      region: "西湖区",
      coordinateReference: "WGS84",
    });
    expect(screen.getByLabelText("范围地图").textContent).toContain(
      JSON.stringify(polygon),
    );
    expect(
      screen.getByLabelText("范围地图").getAttribute("data-projection"),
    ).toBe("planar");
    expect(screen.getByText("高度未明确，请后续核验")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认导入" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(result));
  });
  it("不导入有逐条错误的批次，选择新文件立即作废旧预览", async () => {
    setup({
      report: {
        ...preview,
        batchId: null,
        canCommit: false,
        summary: { ...preview.summary, valid: 0, invalid: 1 },
        rows: [
          {
            ...preview.rows[0],
            errors: [{ code: "SELF_INTERSECTION", message: "空域边界自相交" }],
          },
        ],
      },
    });
    await validate();
    expect(screen.getByText("空域边界自相交")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认导入" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    chooseFile("replacement.json");
    expect(screen.queryByLabelText("空域导入预览")).toBeNull();
  });
  it("修改高度或区域后必须重新预览，统一高度不从来源 Z 推断", async () => {
    const { calls } = setup();
    await validate();
    fireEvent.click(screen.getByText(/可选：统一高度/));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "高度上限（米）" }),
      { target: { value: "120" } },
    );
    expect(screen.queryByLabelText("空域导入预览")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "请选择离地或海拔基准",
    );
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    await waitFor(() =>
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0),
    );
    expect(calls.filter((call) => call.path.endsWith("/preview"))).toHaveLength(
      1,
    );
  });
  it("提交响应失败后重试同批次，成功后通知刷新并关闭", async () => {
    const { calls, onClose, onImported } = setup({
      commits: [
        response(null, 503, "NETWORK_ERROR", "响应暂不可用"),
        response(result),
      ],
    });
    await validate();
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await screen.findByText(/可重试确认本批次/);
    expect(onImported).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(
      calls
        .filter((call) => call.path.endsWith("/commit"))
        .map((call) => call.path),
    ).toEqual([
      "/api/v1/resources/airspace-imports/batch-1/commit",
      "/api/v1/resources/airspace-imports/batch-1/commit",
    ]);
  });
  it("服务端确认过期后禁止重试提交，保留文件以便重新预览", async () => {
    const { calls } = setup({
      commits: [response(null, 409, "IMPORT_PREVIEW_EXPIRED", "预览已过期")],
    });
    await validate();
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await screen.findByText("预览已过期，请重新校验预览。");
    expect(
      (screen.getByRole("button", { name: "确认导入" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "重新校验预览" }));
    await waitFor(() =>
      expect(
        calls.filter((call) => call.path.endsWith("/preview")),
      ).toHaveLength(2),
    );
  });
  it("拒绝不支持格式和超限文件，提供可下载示例", async () => {
    const { calls } = setup();
    chooseRegion();
    chooseFile("unsupported.kml");
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    expect(
      await screen.findByText("仅支持 .geojson 或 .json 文件"),
    ).toBeTruthy();
    const file = new File(["x".repeat(2 * 1024 * 1024 + 1)], "large.json");
    fireEvent.change(screen.getByLabelText("GeoJSON 文件"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "校验并预览" }));
    expect(await screen.findByText("文件不能超过 2 MiB")).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(
      screen
        .getByRole("link", { name: "下载示例文件" })
        .getAttribute("download"),
    ).toMatch(/\.geojson$/);
  });
});
