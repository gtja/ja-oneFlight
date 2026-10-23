// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserContext } from "../../context";
import type { CurrentUser } from "../../api";
import RequestAssistant from "./RequestAssistant";
import TaskRequestForm from "./TaskRequestForm";

const fixture = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("../../api", async () => {
  const actual = await vi.importActual<typeof import("../../api")>("../../api");
  return { ...actual, write: fixture.write };
});
vi.mock("../../components/Workflow", () => ({
  useMutationFeedback: () => async (action: () => Promise<unknown>) => action(),
}));
vi.mock("../../components/GeometryInput", () => ({ default: () => null }));
const user: CurrentUser = {
  id: "user",
  username: "department",
  displayName: "需求人员",
  role: "DEPARTMENT",
  organizationId: "org",
  regions: [],
  deviceIds: [],
};
const onClose = vi.fn();
function start(
  content = <RequestAssistant organizations={[]} onClose={onClose} />,
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UserContext.Provider value={user}>{content}</UserContext.Provider>
    </QueryClientProvider>,
  );
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}
function fillAssistant() {
  fireEvent.click(screen.getByRole("button", { name: "下一步：填写需求" }));
  fireEvent.change(screen.getByLabelText(/作业对象 \/ 具体位置/), {
    target: { value: "测试林区北侧" },
  });
  choose("作业区域", "西湖区");
  fireEvent.change(screen.getByLabelText(/期望开始时间/), {
    target: { value: "2026-10-24T09:00" },
  });
  fireEvent.change(screen.getByLabelText(/期望结束时间/), {
    target: { value: "2026-10-24T10:00" },
  });
}
beforeEach(() => {
  fixture.write.mockReset();
  onClose.mockReset();
});
afterEach(cleanup);

describe("需求助手", () => {
  it("场景模板可改，回退和切换场景保留各自草稿，实时预览不发请求", () => {
    start();
    fillAssistant();
    fireEvent.change(screen.getByLabelText(/检查重点/), {
      target: { value: "重点核查北侧烟雾" },
    });
    expect(
      within(screen.getByRole("region", { name: "作业要求预览" })).getByText(
        /重点核查北侧烟雾/,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    fireEvent.click(screen.getByRole("button", { name: /河道巡查/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写需求" }));
    expect(
      (screen.getByLabelText(/作业对象 \/ 具体位置/) as HTMLTextAreaElement)
        .value,
    ).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    fireEvent.click(screen.getByRole("button", { name: /森林防火/ }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：填写需求" }));
    expect(
      (screen.getByLabelText(/作业对象 \/ 具体位置/) as HTMLTextAreaElement)
        .value,
    ).toBe("测试林区北侧");
    expect(
      (screen.getByLabelText(/检查重点/) as HTMLTextAreaElement).value,
    ).toBe("重点核查北侧烟雾");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it("提交失败后只重试原草稿，修改后先保存同一编号再提交", async () => {
    fixture.write
      .mockResolvedValueOnce({ id: "draft-1" })
      .mockRejectedValueOnce(new Error("审批资料待完善"))
      .mockResolvedValueOnce({ id: "draft-1" })
      .mockResolvedValueOnce({ id: "draft-1" });
    start();
    fillAssistant();
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await screen.findByRole("alert");
    expect(fixture.write.mock.calls[0][0]).toBe("/tasks");
    expect(fixture.write.mock.calls[0][1]).toMatchObject({
      scene: "森林防火",
      region: "西湖区",
      startAt: "2026-10-24T01:00:00.000Z",
      organizationId: "org",
    });
    fireEvent.change(screen.getByLabelText(/检查重点/), {
      target: { value: "修改检查要求" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(
      fixture.write.mock.calls.map((call) => [call[0], call[2] || "POST"]),
    ).toEqual([
      ["/tasks", "POST"],
      ["/tasks/draft-1/actions", "POST"],
      ["/tasks/draft-1", "PUT"],
      ["/tasks/draft-1/actions", "POST"],
    ]);
  });

  it("未修改内容重试不重复保存，未知创建结果不自动再次创建", async () => {
    fixture.write
      .mockResolvedValueOnce({ id: "draft-2" })
      .mockRejectedValueOnce(new Error("提交失败"))
      .mockResolvedValueOnce({});
    start();
    fillAssistant();
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fixture.write.mock.calls.map((call) => call[0])).toEqual([
      "/tasks",
      "/tasks/draft-2/actions",
      "/tasks/draft-2/actions",
    ]);
    cleanup();
    fixture.write.mockReset();
    onClose.mockReset();
    fixture.write.mockRejectedValue(new TypeError("Failed to fetch"));
    start();
    fillAssistant();
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await screen.findByText(/创建结果尚未确认/);
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "提交需求" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(fixture.write).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("拒绝结束早于开始的时间", async () => {
    start();
    fillAssistant();
    fireEvent.change(screen.getByLabelText(/期望结束时间/), {
      target: { value: "2026-10-24T08:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "期望结束时间必须晚于开始时间。",
    );
    expect(fixture.write).not.toHaveBeenCalled();
  });

  it("提交期间禁止重复提交和关闭，避免丢失已发起的创建请求", async () => {
    let completeCreate!: (value: { id: string }) => void;
    fixture.write
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            completeCreate = resolve;
          }),
      )
      .mockResolvedValueOnce({ id: "busy-draft" });
    start();
    fillAssistant();
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    expect(
      screen
        .getByRole("button", { name: "正在提交…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(fixture.write).toHaveBeenCalledOnce();
    completeCreate({ id: "busy-draft" });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fixture.write.mock.calls.map((call) => call[0])).toEqual([
      "/tasks",
      "/tasks/busy-draft/actions",
    ]);
  });

  it("普通提报独立并保留默认场景，同样沿用已保存的草稿重试", async () => {
    fixture.write
      .mockResolvedValueOnce({ id: "ordinary" })
      .mockRejectedValueOnce(new Error("提交失败"))
      .mockResolvedValueOnce({});
    start(
      <TaskRequestForm
        organizationId="org"
        onClose={onClose}
        onBusyChange={vi.fn()}
        fields={[
          { key: "title", label: "任务名称", required: true },
          {
            key: "scene",
            label: "应用场景",
            options: ["森林防火", "河道巡查"].map((value) => ({
              value,
              label: value,
            })),
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "应用场景" }).textContent,
    ).toContain("森林防火");
    fireEvent.change(screen.getByLabelText(/任务名称/), {
      target: { value: "普通提报" },
    });
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await screen.findByText(/草稿已保存，提交未完成/);
    fireEvent.click(screen.getByRole("button", { name: "提交需求" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(fixture.write.mock.calls.map((call) => call[0])).toEqual([
      "/tasks",
      "/tasks/ordinary/actions",
      "/tasks/ordinary/actions",
    ]);
  });
});
