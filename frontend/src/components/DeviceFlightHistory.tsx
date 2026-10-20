import { useState } from "react";
import { useData, useList, type Entity } from "../api";
import { dateTime, metersLabel, secondsLabel } from "../domain";
import { getFlightTotals } from "../flightStatistics";
import { DataTable, Details, ListFooter, Status, Tabs } from "./UI";

export function DeviceFlightSummary({ device }: { device: Entity }) {
  const totals = getFlightTotals(device);
  return (
    <section className="section device-flight-summary">
      <h3>累计飞行统计</h3>
      <Details
        items={[
          {
            label: "累计飞行架次",
            value:
              totals?.sorties === null || totals?.sorties === undefined
                ? "未知"
                : `${totals.sorties} 架次`,
          },
          { label: "累计飞行时长", value: secondsLabel(totals?.timeSeconds) },
          { label: "累计飞行距离", value: metersLabel(totals?.distanceMeters) },
          { label: "累计统计上报时间", value: dateTime(totals?.reportedAt) },
        ]}
      />
      {!totals && (
        <p className="muted">
          该设备未提供累计统计。下方可查询该设备的架次和任务执行记录。
        </p>
      )}
    </section>
  );
}

export default function DeviceFlightHistory({
  device,
  showSummary = true,
}: {
  device: Entity;
  showSummary?: boolean;
}) {
  const [tab, setTab] = useState("flights");
  const detail = useData<Entity>(`/devices/${encodeURIComponent(device.id)}`);
  const flights = useList("/flights", { deviceId: device.id, pageSize: 20 });
  const executions = useList(
    "/executions",
    { deviceId: device.id, pageSize: 20 },
    tab === "executions",
  );
  const current = detail.data || device;
  return (
    <div className="device-flight-history">
      {showSummary && <DeviceFlightSummary device={current} />}
      {detail.error && (
        <p className="form-error">设备统计获取失败：{detail.error.message}</p>
      )}
      <section className="section">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "flights", label: "架次记录", count: flights.data?.total },
            {
              id: "executions",
              label: "任务执行记录",
              count: executions.data?.total,
            },
          ]}
        />
        {tab === "flights" ? (
          <>
            <h3>设备飞行架次记录</h3>
            <DataTable
              rows={flights.data?.items || []}
              loading={flights.isLoading}
              error={flights.error}
              emptyTitle="该设备暂无架次记录"
              emptyDescription="只查询当前设备原始编号关联的真实飞行记录。"
              columns={[
                { key: "sortieNo", label: "架次编号" },
                {
                  key: "flightTimeSeconds",
                  label: "飞行时长",
                  render: (row) => secondsLabel(row.flightTimeSeconds),
                },
                {
                  key: "flightDistanceMeters",
                  label: "飞行距离",
                  render: (row) => metersLabel(row.flightDistanceMeters),
                },
                {
                  key: "reportedAt",
                  label: "上报时间",
                  render: (row) => dateTime(row.reportedAt),
                },
                {
                  key: "takeoffAt",
                  label: "实际起飞",
                  render: (row) => dateTime(row.takeoffAt),
                },
                {
                  key: "landingAt",
                  label: "实际落地",
                  render: (row) => dateTime(row.landingAt),
                },
              ]}
            />
            <ListFooter page={flights.data} onChange={flights.setPage} />
            <p className="footnote">
              历史留存记录条数与累计飞行架次分别统计。上报时间为记录上报时间，真实起降时间未提供时保持未知。
            </p>
          </>
        ) : (
          <>
            <h3>来源任务执行记录</h3>
            <DataTable
              rows={executions.data?.items || []}
              loading={executions.isLoading}
              error={executions.error}
              emptyTitle="该设备暂无任务执行记录"
              columns={[
                { key: "name", label: "原生作业名称" },
                {
                  key: "executionStartAt",
                  label: "执行开始时间",
                  render: (row) => dateTime(row.executionStartAt),
                },
                {
                  key: "executionEndAt",
                  label: "执行结束时间",
                  render: (row) => dateTime(row.executionEndAt),
                },
                {
                  key: "status",
                  label: "历史执行状态",
                  render: (row) => <Status status={row.status} />,
                },
              ]}
            />
            <ListFooter page={executions.data} onChange={executions.setPage} />
            <p className="footnote">
              任务执行时间与物理起降时间分别展示。来源没有提供的状态保持未知。
            </p>
          </>
        )}
      </section>
    </div>
  );
}
