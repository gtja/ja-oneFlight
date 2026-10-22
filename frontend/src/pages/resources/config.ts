import { entityName, type Entity } from "../../api";
import { REGIONS } from "../../domain";
import type { Field } from "../../components/UI";

export const resourceKinds: Record<string, string> = {
  DEVICE: "设备资源",
  PERSON: "人员资源",
  ROUTE: "航线资源",
  AIRSPACE: "空域资源",
  MAINTENANCE: "设备维护",
  FLIGHT: "飞行记录",
  MEDIA: "成果媒体",
};
export const sourceCatalogs: Record<string, string> = {
  PERSON: "people",
  ROUTE: "routes",
  AIRSPACE: "airspaces",
};
export const deviceTypeLabels: Record<string, string> = {
  UAV: "飞机",
  UAV_AIRPORT: "机巢",
  AI_POD: "算力舱",
  CAMERA: "摄像机",
  RADAR: "雷达",
};
export const deviceTypeOptions = [
  { value: "", label: "全部设备类型" },
  ...Object.entries(deviceTypeLabels).map(([value, label]) => ({
    value,
    label,
  })),
];
export const schedulingLabel = (status?: string) =>
  status === "ACTIVE"
    ? "可调度"
    : status === "PENDING_CONFIRMATION"
      ? "待确认"
      : undefined;

export function resourceFields({
  kind,
  organizations,
  devices,
  dispatchBySource,
  form,
}: {
  kind: string;
  organizations: Entity[];
  devices: Entity[];
  dispatchBySource: Map<string, Entity>;
  form: Entity | boolean | null;
}): Field[] {
  return [
    {
      key: "organizationId",
      label: "业务所属组织",
      required: true,
      options: organizations.map((r) => ({
        value: r.id,
        label: entityName(r),
      })),
    },
    { key: "title", label: "资源名称", required: true, wide: true },
    {
      key: "region",
      label: "所属区域",
      required: true,
      options: REGIONS.map((v) => ({ value: v, label: v })),
    },
    {
      key: "status",
      label: kind === "DEVICE" ? "调度状态" : "资源状态",
      required: true,
      options: [
        { value: "ACTIVE", label: kind === "DEVICE" ? "可调度" : "可用" },
        { value: "PENDING_CONFIRMATION", label: "待确认" },
        { value: "MAINTENANCE", label: "维护中" },
        { value: "INACTIVE", label: "停用" },
      ],
    },
    { key: "model", label: kind === "PERSON" ? "岗位 / 资质" : "型号 / 类型" },
    { key: "description", label: "能力与备注", type: "textarea", wide: true },
    ...(kind === "DEVICE"
      ? [
          {
            key: "sourceDeviceId",
            label: "关联来源设备",
            options: devices
              .filter((device) => {
                const existing = dispatchBySource.get(device.id);
                return (
                  !existing ||
                  (typeof form === "object" && existing.id === form?.id)
                );
              })
              .map((r) => ({ value: r.id, label: entityName(r) })),
          },
          { key: "sn", label: "设备序列号" },
          { key: "longitude", label: "经度（WGS84）", type: "number" },
          { key: "latitude", label: "纬度（WGS84）", type: "number" },
        ]
      : kind === "ROUTE" || kind === "AIRSPACE"
        ? [
            {
              key: "geometry",
              label: kind === "ROUTE" ? "航线绘制" : "空域边界绘制",
              type: "geometry",
              geometryMode: (kind === "ROUTE" ? "ROUTE" : "AIRSPACE") as
                "ROUTE" | "AIRSPACE",
              required: true,
              wide: true,
              placeholder: '{"type":"Polygon","coordinates":[…]}',
            },
          ]
        : kind === "MAINTENANCE"
          ? [
              {
                key: "deviceId",
                label: "维护设备",
                required: true,
                options: devices.map((r) => ({
                  value: r.id,
                  label: entityName(r),
                })),
              },
              {
                key: "maintenanceAt",
                label: "维护日期",
                type: "date",
                required: true,
              },
            ]
          : []),
  ];
}
