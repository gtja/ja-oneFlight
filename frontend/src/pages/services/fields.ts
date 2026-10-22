import { entityName, type Entity } from "../../api";
import { REGIONS } from "../../domain";
import type { Field } from "../../components/UI";

export const planKinds = [
  { value: "DAILY", label: "日常计划" },
  { value: "LONG_TERM", label: "长期计划" },
  { value: "DEVICE_ADMISSION", label: "设备准入" },
  { value: "PILOT_ADMISSION", label: "人员准入" },
];
const planFields: Field[] = [
  { key: "title", label: "申请名称", required: true, wide: true },
  { key: "kind", label: "申请类型", required: true, options: planKinds },
  {
    key: "region",
    label: "适用区域",
    required: true,
    options: REGIONS.map((v) => ({ value: v, label: v })),
  },
  { key: "startAt", label: "开始时间", type: "datetime-local", required: true },
  { key: "endAt", label: "结束时间", type: "datetime-local", required: true },
  { key: "height", label: "申请高度（米）", type: "number" },
  { key: "materialName", label: "资格 / 材料名称" },
  { key: "materialNumber", label: "证照 / 材料编号" },
  { key: "validFrom", label: "材料有效起始日", type: "date" },
  { key: "validUntil", label: "材料有效截止日", type: "date" },
  {
    key: "scope",
    label: "飞行范围 / 材料说明",
    type: "textarea",
    required: true,
    wide: true,
  },
];

export const consultationFields: Field[] = [
  {
    key: "title",
    label: "服务主题",
    required: true,
    wide: true,
  },
  {
    key: "kind",
    label: "服务类型",
    required: true,
    options: [
      { value: "CONSULTATION", label: "咨询" },
      { value: "TRAINING", label: "培训" },
    ],
  },
  {
    key: "region",
    label: "所属区域",
    required: true,
    options: REGIONS.map((v) => ({ value: v, label: v })),
  },
  {
    key: "description",
    label: "需求说明",
    type: "textarea",
    required: true,
    wide: true,
  },
];

export function serviceFields({
  manage,
  organizations,
  resources,
  tasks,
}: {
  manage: boolean;
  organizations: Entity[];
  resources: Entity[];
  tasks: Entity[];
}) {
  const fields: Field[] = [
    ...planFields,
    ...(manage
      ? [
          {
            key: "organizationId",
            label: "申请部门",
            required: true,
            options: organizations.map((r) => ({
              value: r.id,
              label: entityName(r),
            })),
          },
        ]
      : []),
    {
      key: "resourceId",
      label: "关联设备 / 人员档案",
      options: resources
        .filter((r) => ["DEVICE", "PERSON"].includes(String(r.kind)))
        .map((r) => ({ value: r.id, label: entityName(r) })),
    },
    ...(manage
      ? [
          {
            key: "taskId",
            label: "关联已有任务（可选）",
            options: tasks.map((r) => ({
              value: r.id,
              label: entityName(r),
            })),
          },
        ]
      : []),
  ];
  const basicFlightFields = fields
    .filter((field) =>
      [
        "title",
        "kind",
        "region",
        "startAt",
        "endAt",
        "scope",
        "organizationId",
      ].includes(field.key),
    )
    .map((field) =>
      field.key === "kind"
        ? {
            ...field,
            options: planKinds.filter((option) =>
              ["DAILY", "LONG_TERM"].includes(option.value),
            ),
          }
        : field.key === "scope"
          ? { ...field, label: "飞行范围 / 用途" }
          : field,
    );
  const optionalFlightFields = fields
    .filter((field) => ["height", "resourceId", "taskId"].includes(field.key))
    .map((field) =>
      field.key === "resourceId"
        ? {
            ...field,
            label: "关联设备（可选）",
            options: resources
              .filter((resource) => resource.kind === "DEVICE")
              .map((resource) => ({
                value: resource.id,
                label: entityName(resource),
              })),
          }
        : field,
    );
  const admissionFields = fields.map((field) =>
    field.key === "kind"
      ? {
          ...field,
          options: planKinds.filter(
            (option) => !["DAILY", "LONG_TERM"].includes(option.value),
          ),
        }
      : field,
  );
  return { fields, basicFlightFields, optionalFlightFields, admissionFields };
}
