// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Entity } from "../api";
import { UserContext } from "../context";
import Algorithms from "./Algorithms";

const fixture = vi.hoisted(() => ({
  rows: [] as Entity[],
  loading: false,
  listError: null as Error | null,
  categoryError: null as Error | null,
  statisticsError: null as Error | null,
  records: [] as Entity[],
  list: vi.fn(),
  setPage: vi.fn(),
  write: vi.fn(),
  listRefetch: vi.fn(),
  categoryRefetch: vi.fn(),
  statisticsRefetch: vi.fn(),
}));
vi.mock("../api", () => ({
  entityName: (entity?: Entity) =>
    String(entity?.title || entity?.name || "未命名"),
  queryString: (params: Record<string, unknown>) =>
    new URLSearchParams(
      Object.entries(params)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => [key, String(value)]),
    ).toString(),
  useList: (
    path: string,
    params: Record<string, unknown>,
    enabled: boolean,
  ) => {
    fixture.list(path, params, enabled);
    const items =
      path === "/algorithms"
        ? fixture.rows
        : path === "/resources"
          ? fixture.records
          : [];
    return {
      data:
        path === "/algorithms" && (fixture.listError || fixture.loading)
          ? undefined
          : {
              items,
              total:
                path === "/algorithms" && items.length ? 205 : items.length,
              page: 1,
              pageSize: 100,
            },
      error: path === "/algorithms" ? fixture.listError : null,
      isLoading: path === "/algorithms" && fixture.loading,
      setPage: fixture.setPage,
      refetch: fixture.listRefetch,
    };
  },
  useData: (path: string) =>
    path === "/algorithms/categories"
      ? {
          data: fixture.categoryError
            ? undefined
            : [{ key: "fire", name: "火情识别", count: 2 }],
          error: fixture.categoryError,
          refetch: fixture.categoryRefetch,
        }
      : {
          data: fixture.statisticsError
            ? undefined
            : { all: 3, deployed: 1, undeployed: null },
          error: fixture.statisticsError,
          refetch: fixture.statisticsRefetch,
        },
  write: fixture.write,
}));
vi.mock("../components/Workflow", () => ({
  useMutationFeedback: () => async (action: () => Promise<unknown>) => action(),
  Provenance: () => null,
}));
vi.mock("../components/SourceRecords", () => ({
  default: () => <p>来源识别记录列表</p>,
}));
vi.mock("../components/GeometryInput", () => ({ default: () => null }));
const user: CurrentUser = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  role: "ADMIN",
  organizationId: "org",
  regions: [],
  deviceIds: [],
};
function start(role: CurrentUser["role"] = "ADMIN") {
  return render(
    <UserContext.Provider value={{ ...user, role }}>
      <Algorithms />
    </UserContext.Provider>,
  );
}
function choose(label: string, value: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: value }));
}
beforeEach(() => {
  fixture.rows = [
    {
      id: "1",
      name: "未知模型",
      deployed: null,
      categories: ["火情识别"],
      version: "v1",
    },
    { id: "2", name: "未部署模型", deployed: false, version: "v2" },
    { id: "3", name: "已部署模型", deployed: true, version: "v3" },
  ];
  fixture.loading = false;
  fixture.listError = null;
  fixture.categoryError = null;
  fixture.statisticsError = null;
  fixture.records = [];
  for (const mock of [
    fixture.list,
    fixture.setPage,
    fixture.write,
    fixture.listRefetch,
    fixture.categoryRefetch,
    fixture.statisticsRefetch,
  ])
    mock.mockReset();
});
afterEach(cleanup);

describe("算法工作区", () => {
  it("三态部署状态一致，保留只读设备查询并提供窄屏返回入口", () => {
    start();
    expect(screen.getAllByText("部署状态未知")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /未知模型.*部署状态未知/ }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "部署算法" })).toBeNull();
    expect(screen.queryByRole("button", { name: "提交训练" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /未部署模型/ }));
    expect(
      document.querySelector(".algorithm-workspace.detail-open"),
    ).toBeTruthy();
    const detail = document.querySelector(".algorithm-detail") as HTMLElement;
    expect(within(detail).getByText("未部署", { selector: "dd" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看部署设备" }));
    expect(
      screen.getByRole("dialog", { name: "未部署模型 · 部署设备" }),
    ).toBeTruthy();
    expect(fixture.list).toHaveBeenCalledWith(
      "/algorithms/2/devices",
      {},
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "返回算法目录" }));
    expect(
      document.querySelector(".algorithm-workspace.detail-open"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /已部署模型/ }));
    expect(within(detail).getByText("已部署", { selector: "dd" })).toBeTruthy();
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it("搜索、真实分类、部署筛选及分页沿用原查询协议", () => {
    start();
    fireEvent.change(screen.getByPlaceholderText("搜索算法名称或能力"), {
      target: { value: "烟雾" },
    });
    choose("算法分类", "火情识别");
    choose("部署筛选", "已部署");
    expect(fixture.list).toHaveBeenLastCalledWith(
      "/tasks/none/detections",
      {},
      false,
    );
    expect(fixture.list).toHaveBeenCalledWith(
      "/algorithms",
      { keyword: "烟雾", category: "fire", deployment: "deployed" },
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(fixture.setPage).toHaveBeenCalledWith(2);
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it("列表失败与成功空结果分开，并单独重试分类与统计", () => {
    fixture.rows = [];
    fixture.listError = new Error("目录连接失败");
    fixture.categoryError = new Error("分类连接失败");
    fixture.statisticsError = new Error("统计连接失败");
    const view = start();
    expect(screen.queryByText("暂无算法")).toBeNull();
    expect(screen.getAllByText("目录连接失败")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "重新读取目录" }));
    fireEvent.click(screen.getByRole("button", { name: "重试分类" }));
    fireEvent.click(screen.getByRole("button", { name: "重试统计" }));
    expect(fixture.listRefetch).toHaveBeenCalledOnce();
    expect(fixture.categoryRefetch).toHaveBeenCalledOnce();
    expect(fixture.statisticsRefetch).toHaveBeenCalledOnce();
    fixture.listError = null;
    fixture.categoryError = null;
    fixture.statisticsError = null;
    view.rerender(
      <UserContext.Provider value={user}>
        <Algorithms />
      </UserContext.Provider>,
    );
    fireEvent.change(screen.getByPlaceholderText("搜索算法名称或能力"), {
      target: { value: "无此算法" },
    });
    expect(screen.getByText("当前筛选下暂无算法")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清空筛选" }));
    expect(
      (screen.getByPlaceholderText("搜索算法名称或能力") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("加载时不显示空目录，识别来源与本地任务分别访问", () => {
    fixture.loading = true;
    start();
    expect(screen.getAllByText("正在加载…")).toHaveLength(2);
    expect(screen.queryByText("暂无算法")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "识别记录" }));
    expect(screen.getByText("来源识别记录列表")).toBeTruthy();
    expect(fixture.list).toHaveBeenCalledWith("/tasks", {}, false);
    choose("识别记录来源", "本地任务关联");
    expect(fixture.list).toHaveBeenCalledWith("/tasks", {}, true);
    expect(
      screen.getByText("选择关联任务", { selector: "strong" }),
    ).toBeTruthy();
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it("训练事项只登记原资源协议，非管理角色没有登记按钮", async () => {
    fixture.write.mockResolvedValue({ id: "training" });
    start();
    fireEvent.click(screen.getByRole("tab", { name: "样本与训练登记" }));
    fireEvent.click(screen.getByRole("button", { name: "训练事项" }));
    fireEvent.click(screen.getByRole("button", { name: "登记训练事项" }));
    fireEvent.change(screen.getByLabelText(/名称/), {
      target: { value: "测试训练准备" },
    });
    fireEvent.change(screen.getByLabelText(/内容说明/), {
      target: { value: "核对样本与标注" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(fixture.write).toHaveBeenCalledOnce());
    expect(fixture.write).toHaveBeenCalledWith(
      "/resources",
      expect.objectContaining({
        kind: "ALGORITHM_TRAINING",
        status: "PENDING_CONFIGURATION",
        metadata: expect.objectContaining({
          trainingProvider: "NOT_CONFIGURED",
          sampleCount: null,
        }),
      }),
    );
    cleanup();
    start("PILOT");
    fireEvent.click(screen.getByRole("tab", { name: "样本与训练登记" }));
    expect(
      screen.queryByRole("button", { name: /登记样本集合|登记训练事项/ }),
    ).toBeNull();
  });
});
