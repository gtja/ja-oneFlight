export const REGIONS = ["上城区", "拱墅区", "西湖区", "余杭区", "萧山区"];
export const SCENES = ["森林防火", "矿产监管", "河道巡查", "非现执法"];
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "平台管理员",
  DISPATCH: "市级运营中心",
  DEPARTMENT: "需求部门",
  PILOT: "执行飞手",
};
export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_ASSIGNMENT: "待分配",
  PENDING_EXECUTION: "待执行",
  EXECUTING: "执行中",
  PENDING_ACCEPTANCE: "待验收",
  COMPLETED: "已完成",
  RETURNED: "需补正",
  CANCELLED: "已取消",
  PENDING_REVIEW: "待审核",
  PENDING_CONFIRMATION: "待确认",
  PENDING_LABELING: "待标注",
  PENDING_CONFIGURATION: "待接入",
  APPROVED: "已通过",
  PENDING_DISPOSAL: "待处置",
  PENDING_TRANSFER: "待移交",
  RESOLVED: "已处置",
  ARCHIVED: "已归档",
  OPEN: "待答复",
  ANSWERED: "已答复",
  AVAILABLE: "可用",
  MAINTENANCE: "维护中",
  INACTIVE: "停用",
  ACTIVE: "正常",
  ONLINE: "在线",
  OFFLINE: "离线",
  UNKNOWN: "未知",
  UNCONFIGURED: "未配置",
  NOT_CONFIGURED: "未配置",
  CONNECTED: "已连接",
  HEALTHY: "已连接",
  ERROR: "连接异常",
  STALE: "数据过期",
  DISCONNECTED: "未连接",
  SUCCESS: "成功",
};
export const statusLabel = (status?: string) =>
  STATUS_LABELS[status || "UNKNOWN"] || status || "未知";

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};
const fullDateTimeFormat = new Intl.DateTimeFormat("zh-CN", {
  ...dateTimeOptions,
  year: "numeric",
});
const shortDateTimeFormat = new Intl.DateTimeFormat("zh-CN", dateTimeOptions);

export const dateTime = (date: unknown, short = false) => {
  if (!date) return "—";
  const parsedDate = new Date(String(date));
  if (Number.isNaN(parsedDate.getTime())) return String(date);
  return (short ? shortDateTimeFormat : fullDateTimeFormat).format(parsedDate);
};
export const localInput = (date: unknown) =>
  date
    ? new Date(new Date(String(date)).getTime() + 8 * 3600_000)
        .toISOString()
        .slice(0, 16)
    : "";
export const toInstant = (date: string) =>
  date ? new Date(`${date}:00+08:00`).toISOString() : null;
export const secondsLabel = (v: unknown) =>
  typeof v === "number" ? `${(v / 3600).toFixed(2)} 小时` : "—";
export const metersLabel = (v: unknown) =>
  typeof v === "number" ? `${(v / 1000).toFixed(2)} 公里` : "—";
