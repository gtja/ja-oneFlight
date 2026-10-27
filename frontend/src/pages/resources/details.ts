import type { Entity } from "../../api";

const resourceLabels: Record<string, string> = {
  title: "资源名称",
  name: "资源名称",
  kind: "资源类型",
  type: "设备类型",
  region: "区域",
  model: "型号",
  sn: "序列号",
  sourceDeviceId: "来源设备",
  longitude: "经度",
  latitude: "纬度",
  description: "备注",
  startAt: "开始时间",
  endAt: "结束时间",
  reportedAt: "上报时间",
  flightTimeSeconds: "飞行时长（秒）",
  flightDistanceMeters: "飞行距离（米）",
};

const metadataLabels: Record<string, string> = {
  description: "说明",
  sourceOrganizationName: "来源组织",
  sourceOrganizationCode: "来源组织编号",
  qualificationStatus: "资质状态",
  qualificationNote: "资质说明",
  maintenanceAt: "维护安排日期",
  deviceId: "关联设备",
  geometryStatus: "几何数据",
  coordinateReference: "坐标基准",
  scopeNote: "来源范围",
  sourceCreatedAt: "来源创建时间",
  sourceUpdatedAt: "来源更新时间",
};

const knownValueLabels: Record<string, string> = {
  ACTIVE: "可用",
  INACTIVE: "停用",
  ONLINE: "在线",
  OFFLINE: "离线",
  UNKNOWN: "未知",
  ENABLED: "已启用",
  DISABLED: "已停用",
  VALID: "有效",
  INVALID: "无效",
  AVAILABLE: "可用",
  VISIBLE: "可见",
  UAV: "飞机",
  UAV_AIRPORT: "机巢",
  DOCK: "机巢",
  AI_POD: "算力舱",
  CAMERA: "摄像机",
  RADAR: "雷达",
  ROUTE: "航线",
  AIRSPACE: "空域",
  AIRCRAFT: "航空器",
  PERSON: "人员",
  MAINTENANCE: "维护中",
  PENDING_CONFIRMATION: "待确认",
  WGS84: "WGS84 坐标系",
  SOURCE_MAP_UNSPECIFIED: "来源未说明",
  SUCCESS: "成功",
  FAILED: "失败",
  RUNNING: "进行中",
  PENDING: "待处理",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
  ARCHIVED: "已归档",
  "image/jpeg": "JPEG 图片",
  "image/png": "PNG 图片",
  "image/gif": "GIF 图片",
  "image/webp": "WebP 图片",
};

export function resourceValueLabel(value: string) {
  return knownValueLabels[value] || knownValueLabels[value.toUpperCase()] || value;
}

export function resourceDetails(record: Entity, kind: string) {
  return Object.entries(record)
    .filter(
      ([key]) =>
        ![
          "id",
          "metadata",
          "details",
          "flightTotals",
          "provenance",
          ...(kind === "DEVICE" ? ["status"] : []),
        ].includes(key),
    )
    .map(([key, v]) => ({
      label: resourceLabels[key] || key,
      value:
        v === null
          ? "未知"
          : typeof v === "object"
            ? JSON.stringify(v)
            : resourceValueLabel(String(v)),
    }));
}

export function resourceMetadataDetails(metadata: Record<string, unknown>) {
  return Object.entries(metadata)
    .filter(([key]) => Object.hasOwn(metadataLabels, key))
    .map(([key, val]) => ({
      label: metadataLabels[key] || key,
      value:
        val == null
          ? "未知"
          : key === "qualificationStatus" && val === "UNKNOWN"
            ? "待核验"
            : key === "coordinateReference" && val === "SOURCE_MAP_UNSPECIFIED"
              ? "来源未说明"
              : resourceValueLabel(String(val)),
    }));
}
