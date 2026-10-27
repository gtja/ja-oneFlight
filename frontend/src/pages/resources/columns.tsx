import type { ComponentProps, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { entityName } from "../../api";
import { dateTime, metersLabel, secondsLabel } from "../../domain";
import { getFlightTotals } from "../../flightStatistics";
import { airspaceHeightLabel } from "../../geometry";
import {
  resolveDevicePresentation,
  showsFlightHistory,
} from "../../devicePresentation";
import { Status, type DataTable } from "../../components/UI";
import { resourceKinds as kinds, schedulingLabel } from "./config";
import { resourceValueLabel } from "./details";

export function resourceColumns(
  kind: string,
  remote: boolean,
  dispatchStatus: (deviceId: string) => ReactNode,
): ComponentProps<typeof DataTable>["columns"] {
  return kind === "FLIGHT"
    ? [
        { key: "sortieNo", label: "架次编号" },
        { key: "deviceId", label: "来源设备" },
        {
          key: "flightTimeSeconds",
          label: "飞行时长",
          render: (r) => secondsLabel(r.flightTimeSeconds),
        },
        {
          key: "flightDistanceMeters",
          label: "飞行距离",
          render: (r) => metersLabel(r.flightDistanceMeters),
        },
        {
          key: "reportedAt",
          label: "上报时间",
          render: (r) => dateTime(r.reportedAt),
        },
        {
          key: "details",
          label: "操作",
          render: () => (
            <span className="text-link">
              查看记录 <ArrowRight size={12} />
            </span>
          ),
        },
      ]
    : kind === "DEVICE" && remote
      ? [
          {
            key: "name",
            label: "设备名称",
            render: (r) => (
              <div className="name-cell">
                <strong>{entityName(r)}</strong>
                <small>{r.id}</small>
              </div>
            ),
          },
          {
            key: "type",
            label: "设备类型",
            render: (r) => resolveDevicePresentation(r).label,
          },
          { key: "sn", label: "序列号" },
          {
            key: "sorties",
            label: "累计飞行架次",
            render: (r) =>
              showsFlightHistory(r)
                ? (getFlightTotals(r)?.sorties ?? "未知")
                : "—",
          },
          {
            key: "timeSeconds",
            label: "累计飞行时长",
            render: (r) =>
              showsFlightHistory(r)
                ? secondsLabel(getFlightTotals(r)?.timeSeconds)
                : "—",
          },
          {
            key: "distanceMeters",
            label: "累计飞行距离",
            render: (r) =>
              showsFlightHistory(r)
                ? metersLabel(getFlightTotals(r)?.distanceMeters)
                : "—",
          },
          {
            key: "status",
            label: "来源状态",
            render: (r) => <Status status={r.status} label={resourceValueLabel(String(r.status || "UNKNOWN"))} />,
          },
          {
            key: "dispatchStatus",
            label: "调度状态",
            render: (r) => dispatchStatus(r.id),
          },
          {
            key: "details",
            label: "操作",
            render: () => (
              <span className="text-link">
                查看设备详情 <ArrowRight size={12} />
              </span>
            ),
          },
        ]
      : kind === "MEDIA"
        ? [
            { key: "fileName", label: "文件名称" },
            {
              key: "contentType",
              label: "文件类型",
              render: (r) => resourceValueLabel(String(r.contentType || "未知")),
            },
            {
              key: "createdAt",
              label: "上传时间",
              render: (r) => dateTime(r.createdAt),
            },
            { key: "taskId", label: "关联任务" },
          ]
        : [
            {
              key: "title",
              label: "资源名称",
              render: (r) => (
                <div className="name-cell">
                  <strong>{entityName(r)}</strong>
                  <small>{r.id}</small>
                </div>
              ),
            },
            {
              key: "kind",
              label: "资源类型",
              render: (r) =>
                String(r.type || kinds[String(r.kind)] || kinds[kind]),
            },
            { key: "region", label: "所属区域" },
            { key: "model", label: "型号 / 资质" },
            ...(kind === "AIRSPACE"
              ? [
                  {
                    key: "airspaceProfile",
                    label: "高度范围",
                    render: (r: import("../../api").Entity) =>
                      airspaceHeightLabel(
                        (r.metadata as Record<string, unknown> | undefined)
                          ?.airspaceProfile,
                      ),
                  },
                ]
              : []),
            {
              key: "status",
              label: kind === "DEVICE" ? "调度状态" : "状态",
              render: (r) => (
                <Status
                  status={r.status}
                  label={
                    kind === "DEVICE" ? schedulingLabel(r.status) : undefined
                  }
                />
              ),
            },
            {
              key: "details",
              label: "操作",
              render: () => <span className="text-link">查看档案</span>,
            },
          ];
}
