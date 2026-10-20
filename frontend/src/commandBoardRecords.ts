import type { Entity } from "./api";
import type { CommandRecordGroup } from "./components/CommandRecordList";
import { deviceObservationStatus } from "./flightDeviceOrder";
import { getFlightTotals } from "./flightStatistics";

export type CommandRecordKey =
  | "aircraft"
  | "sites"
  | "online"
  | "openCases"
  | "reviewedCases"
  | "pendingPlans"
  | "pendingTasks"
  | "executingTasks"
  | "completedTasks"
  | "plans"
  | "resources"
  | "sorties"
  | "timeSeconds"
  | "distanceMeters";

export function commandRecordGroups(
  data: {
    aircraft?: Entity[];
    sites?: Entity[];
    fleet?: Entity[];
    localResources?: Entity[];
    scopedTasks?: Entity[];
    scopedPlans?: Entity[];
    scopedCases?: Entity[];
  },
  now: number,
): Record<CommandRecordKey, CommandRecordGroup> {
  const map = (
    title: string,
    items: Entity[] | undefined,
  ): CommandRecordGroup => ({
    title,
    items,
    kind: "map",
    note: "按当前区域展示可见对象，点击后联动地图。",
    destination: "resources",
    destinationLabel: "前往资源管理",
  });
  const tasks = (title: string, statuses: string[]): CommandRecordGroup => ({
    title,
    items: data.scopedTasks?.filter((item) =>
      statuses.includes(String(item.status)),
    ),
    kind: "task",
    note: "当前区域全部日期的任务，点击进入对应任务详情。",
    destination: "dispatch",
    destinationLabel: "前往任务调度",
  });
  const cases = (
    title: string,
    items: Entity[] | undefined,
  ): CommandRecordGroup => ({
    title,
    items,
    kind: "case",
    note: "查看线索内容、当前状态与处置结论。",
    destination: "scenes",
    destinationLabel: "前往场景应用",
  });
  const planGroup: CommandRecordGroup = {
    title: "飞行计划",
    items: data.scopedPlans,
    kind: "plan",
    note: "当前区域全部计划，点击查看对应申请。",
    destination: "services",
    destinationLabel: "前往飞行服务",
  };
  const metric = (
    title: string,
    field: "sorties" | "timeSeconds" | "distanceMeters",
    divisor: number,
    unit: string,
  ): CommandRecordGroup => ({
    ...map(
      title,
      data.fleet?.filter((item) => getFlightTotals(item) !== null),
    ),
    note: "设备累计上报明细，未提供的指标保持未知；点击设备可联动地图。",
    metric: (item) => {
      const value = getFlightTotals(item)?.[field];
      return value == null
        ? "—"
        : `${(value / divisor).toLocaleString("zh-CN", { maximumFractionDigits: divisor === 1 ? 0 : 2 })} ${unit}`;
    },
  });
  return {
    aircraft: map("航空器", data.aircraft),
    sites: map("起降点", data.sites),
    online: map(
      "在线设备",
      data.fleet?.filter(
        (item) => deviceObservationStatus(item, now) === "ONLINE",
      ),
    ),
    openCases: cases(
      "未结线索",
      data.scopedCases?.filter((item) => item.status !== "ARCHIVED"),
    ),
    reviewedCases: cases(
      "已归档/处置线索",
      data.scopedCases?.filter((item) =>
        ["RESOLVED", "ARCHIVED"].includes(String(item.status)),
      ),
    ),
    pendingPlans: {
      ...planGroup,
      title: "待审计划",
      items: data.scopedPlans?.filter(
        (item) => item.status === "PENDING_REVIEW",
      ),
    },
    pendingTasks: tasks("待执行/分配任务", [
      "PENDING_ASSIGNMENT",
      "PENDING_EXECUTION",
    ]),
    executingTasks: tasks("执行中任务", ["EXECUTING"]),
    completedTasks: tasks("已完成任务", ["COMPLETED"]),
    plans: planGroup,
    resources: map(
      "空域与航线",
      data.localResources?.filter((item) =>
        ["AIRSPACE", "ROUTE"].includes(String(item.kind)),
      ),
    ),
    sorties: metric("累计飞行架次", "sorties", 1, "架次"),
    timeSeconds: metric("累计飞行时长", "timeSeconds", 3600, "小时"),
    distanceMeters: metric("累计飞行里程", "distanceMeters", 1000, "公里"),
  };
}
