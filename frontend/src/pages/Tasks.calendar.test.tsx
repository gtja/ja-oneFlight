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

describe("任务日历的上海日期与源顺序", () => {
  it("按上海跨日分组，保持同日源顺序，隐藏未排期及七天范围之外的任务", () => {
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

    const days = document.querySelectorAll<HTMLElement>(".calendar-day");
    expect(days).toHaveLength(7);
    expect(
      Array.from(
        days[0].querySelectorAll(".calendar-task strong"),
        (item) => item.textContent,
      ),
    ).toEqual(["今天第一条", "今天第二条"]);
    expect(within(days[1]).getByText("明天第一条")).toBeTruthy();
    expect(screen.queryByText("未排期")).toBeNull();
    expect(screen.queryByText("七天之外")).toBeNull();

    fireEvent.click(
      within(days[0]).getByRole("button", { name: /今天第一条/ }),
    );
    expect(screen.getByRole("dialog", { name: "今天第一条" })).toBeTruthy();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it("空队列保留七天网格和原有空数据提示", () => {
    start();
    fireEvent.click(screen.getByRole("button", { name: "日历" }));
    expect(document.querySelectorAll(".calendar-day")).toHaveLength(7);
    expect(screen.getByText("本周暂无已排期任务")).toBeTruthy();
    expect(fixtures.write).not.toHaveBeenCalled();
  });
});
