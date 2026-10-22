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
            : String(v),
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
              : String(val),
    }));
}
