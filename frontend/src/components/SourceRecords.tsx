import { useState } from "react";
import { entityName, useList, type Entity } from "../api";
import { dateTime } from "../domain";
import { DataTable, Details, ListFooter, Modal, SearchBox, Select } from "./UI";

const fieldNames: Record<string, string> = {
  title: "名称",
  id: "来源编号",
  sourceId: "来源编号",
  sourceSystem: "来源系统",
  sourceEntity: "来源目录",
  sourceStatus: "来源状态",
  sourceType: "来源类型",
  sourceDeviceId: "设备编号",
  deviceId: "设备编号",
  sourceDeviceIds: "设备范围",
  sourceCreatedAt: "来源创建时间",
  sourceUpdatedAt: "来源更新时间",
  sourceOrganizationName: "来源组织",
  sourceOrganizationCode: "来源组织编号",
  eventTime: "观测时间",
  eventAt: "观测时间",
  eventType: "识别类型",
  plannedStartAt: "计划开始",
  plannedEndAt: "计划结束",
  startAt: "执行开始",
  endAt: "执行结束",
  confidence: "来源置信度",
  geometryStatus: "几何数据",
  coordinateReference: "坐标基准",
  qualificationStatus: "资质状态",
  qualificationNote: "资质说明",
  scopeNote: "说明",
  sourceTimeWarning: "时间说明",
  mediaType: "文件类型",
  sourceUrl: "原件引用",
};

export default function SourceRecords({ kind }: { kind: string }) {
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const list = useList(`/source-data/${kind}`, {
    keyword: search,
    eventType: kind === "events" ? eventType : undefined,
  });
  const [selected, setSelected] = useState<Entity | null>(null);
  return (
    <>
      <div className="filter-bar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="搜索来源记录"
        />
        {kind === "events" && (
          <Select
            label="识别类型"
            value={eventType}
            onChange={setEventType}
            options={[
              { value: "", label: "全部识别类型" },
              { value: "fire_detection", label: "火情识别" },
              { value: "smoke", label: "烟雾识别" },
              { value: "people", label: "人员识别" },
              { value: "car", label: "车辆识别" },
            ]}
          />
        )}
      </div>
      <DataTable
        rows={list.data?.items || []}
        loading={list.isLoading}
        error={list.error}
        onRow={setSelected}
        columns={[
          { key: "title", label: "来源记录", render: entityName },
          {
            key: "sourceSystem",
            label: "来源系统",
            render: (r) => String(r.sourceSystem || r.system || "来源库"),
          },
          {
            key: "sourceStatus",
            label: "来源状态",
            render: (r) => String(r.sourceStatus || "未知"),
          },
          {
            key: "sourceDeviceId",
            label: "关联设备",
            render: (r) =>
              String(
                r.sourceDeviceId ||
                  r.deviceId ||
                  (r.sourceDeviceIds as string[] | undefined)?.join?.("、") ||
                  "—",
              ),
          },
          {
            key: "sourceCreatedAt",
            label: "来源时间",
            render: (r) =>
              dateTime(r.eventAt || r.eventTime || r.sourceCreatedAt),
          },
        ]}
      />
      <ListFooter page={list.data} onChange={list.setPage} />
      {selected && (
        <Modal
          title={entityName(selected)}
          onClose={() => setSelected(null)}
          wide
        >
          <Details
            items={Object.entries(selected)
              .filter(
                ([key]) =>
                  ![
                    "mediaUrl",
                    "url",
                    "imageUrl",
                    "sourceUrl",
                    "geometry",
                    "sourceGeometry",
                    "parameters",
                  ].includes(key),
              )
              .map(([key, val]) => ({
                label: fieldNames[key] || key,
                value:
                  val == null
                    ? "未知"
                    : /At$|Time$/.test(key)
                      ? dateTime(val)
                      : typeof val === "object"
                        ? JSON.stringify(val)
                        : String(val),
              }))}
          />
          <p className="footnote">
            保留来源状态及时间。识别记录需人工复核，来源执行状态独立于本平台的任务办理进度。
          </p>
        </Modal>
      )}
    </>
  );
}
