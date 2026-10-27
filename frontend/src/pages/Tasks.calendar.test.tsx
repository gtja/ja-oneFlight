// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Entity } from "../api";
import { UserContext } from "../context";
import Tasks from "./Tasks";

const fixtures = vi.hoisted(() => ({ tasks: [] as Entity[], write: vi.fn() }));
vi.mock("../api", () => ({
  entityName: (entity?: Entity) =>
    String(entity?.title || entity?.name || "未命名"),
  useList: (path: string) => ({
    data: {
      items: path === "/tasks" ? fixtures.tasks : [],
      total: path === "/tasks" ? fixtures.tasks.length : 0,
      page: 1,
      pageSize: 20,
    },
    isLoading: false,
    error: null,
    setPage: vi.fn(),
  }),
  useCatalog: () => ({ data: { items: [] }, isLoading: false, error: null }),
  useData: (path: string) => ({
    data:
      path === "/dashboard"
        ? { taskTotal: fixtures.tasks.length, taskCounts: {} }
        : fixtures.tasks.find((task) => path === `/tasks/${task.id}`),
    isLoading: false,
    error: null,
  }),
  write: fixtures.write,
}));
vi.mock("../components/Workflow", () => ({
  useMutationFeedback: () => async (action: () => Promise<unknown>) => action(),
  History: () => null,
  Attachments: () => null,
  Provenance: () => null,
  ActionModal: () => null,
}));
vi.mock("../components/GeometryInput", () => ({ default: () => null }));
vi.mock("../components/SourceRecords", () => ({ default: () => null }));
vi.mock("../components/TaskAssignmentModal", () => ({ default: () => null }));

const user: CurrentUser = {
  id: "department-user",
  username: "department-user",
  displayName: "需求部门",
  role: "DEPARTMENT",
  organizationId: "org",
  regions: [],
  deviceIds: [],
};
function start() {
  render(
    <UserContext.Provider value={user}>
      <Tasks navigate={vi.fn()} />
    </UserContext.Provider>,
  );
}
function task(id: string, startAt?: string): Entity {
  return { id, title: id, startAt, status: "PENDING_ASSIGNMENT" };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:30:00Z"));
  fixtures.tasks = [];
  fixtures.write.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("任务日历的上海日期与排期视图", () => {
  it("需求助手只向可提报角色显示", () => {
    start();
    expect(screen.getByRole("button", { name: "需求助手" })).toBeTruthy();
    cleanup();
    render(
      <UserContext.Provider value={{ ...user, role: "PILOT" }}>
        <Tasks navigate={vi.fn()} />
      </UserContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "需求助手" })).toBeNull();
    expect(screen.queryByRole("button", { name: "提报需求" })).toBeNull();
  });
  it("按上海日期显示整月排期，未排期任务不进入日历", () => {
    fixtures.tasks = [
      task("今天第一条", "2026-10-22T15:00:00Z"),
      task("明天第一条", "2026-10-22T16:00:00Z"),
      task("今天第二条", "2026-10-22T14:00:00Z"),
      task("未排期"),
      task("七天之外", "2026-10-28T16:00:00Z"),
    ];
    start();
    expect(screen.getByText("未排期", { selector: "strong" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "日历" }));

    const days = document.querySelectorAll<HTMLElement>(".task-month-cell");
    expect(days).toHaveLength(35);
    expect(screen.getByText("2026 / 10")).toBeTruthy();
    const day22 = screen
      .getByRole("button", { name: "2026-10-22" })
      .closest(".task-month-cell");
    const day23 = screen
      .getByRole("button", { name: "2026-10-23" })
      .closest(".task-month-cell");
    const day29 = screen
      .getByRole("button", { name: "2026-10-29" })
      .closest(".task-month-cell");
    expect(
      Array.from(
        day22?.querySelectorAll(".task-month-event strong") || [],
        (item) => item.textContent,
      ),
    ).toEqual(["今天第二条", "今天第一条"]);
    expect(
      within(day23 as HTMLElement).getByText("明天第一条"),
    ).toBeTruthy();
    expect(
      within(day29 as HTMLElement).getByText("七天之外"),
    ).toBeTruthy();
    expect(screen.queryByText("未排期")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /今天第一条/ }),
    );
    expect(screen.getByRole("dialog", { name: "今天第一条" })).toBeTruthy();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it("空队列保留完整月历网格", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    expect(document.querySelectorAll(".task-month-cell")).toHaveLength(35);
    expect(document.querySelectorAll(".task-month-event")).toHaveLength(0);
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it("支持按日期切换资源周排期和日排期时窗", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    fireEvent.click(screen.getByRole("button", { name: "资源周排期" }));
    expect(screen.getByText("2026-10-19 — 2026-10-25")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "资源日排期" }));
    expect(screen.getByText("显示时间 07:00—18:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "全天24小时" }));
    expect(screen.getByText("显示时间 00:00—24:00")).toBeTruthy();
  });
});
