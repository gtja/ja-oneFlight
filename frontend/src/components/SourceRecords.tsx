import { useState } from "react";
import { entityName, useList, type Entity } from "../api";
import { dateTime } from "../domain";
import { DataTable, Details, ListFooter, Modal, SearchBox, Select } from "./UI";
import SourceRoutePreview from "./SourceRoutePreview";

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
  templateId: "来源模板编号",
  sourceVersion: "来源版本",
  speedMetersPerSecond: "来源速度（米/秒）",
  heightMeters: "来源高度（米，基准未说明）",
  returnHeightMeters: "来源返航高度（米，基准未说明）",
};
const resourceNotes: Record<string, string> = {
  people:
    "4A 人员目录按当前授权设备及关联组织范围展示，人员资质需核验。登录本平台需在 4A 开通 oneflight 应用，业务岗位另在“权限管理”配置。",
  routes:
    "来源航线目录展示关联当前授权设备的航线模板；坐标基准及几何数据以来源档案为准。",
  airspaces:
    "来源飞行区与围栏按当前授权设备范围展示，不代表监管空域审批结果。监管审批请在“飞行服务”办理。",
};
const resourceLabels: Record<string, string> = {
  people: "人员",
  routes: "航线",
  airspaces: "飞行区与围栏",
};
function associatedDevices(row: Entity) {
  return String(
    row.sourceDeviceId ||
      row.deviceId ||
      (Array.isArray(row.sourceDeviceIds)
        ? row.sourceDeviceIds.join("、")
        : row.sourceDeviceIds) ||
      "—",
  );
}

export default function SourceRecords({
  kind,
  onOpenLocalArchive,
}: {
  kind: string;
  onOpenLocalArchive?: (record: Entity) => void;
}) {
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const list = useList(`/source-data/${kind}`, {
    keyword: search,
    eventType: kind === "events" ? eventType : undefined,
  });
  const [selected, setSelected] = useState<Entity | null>(null);
  return (
    <>
      {resourceNotes[kind] && (
        <p className="notice" role="note">
          {resourceNotes[kind]}
        </p>
      )}
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
        emptyTitle={
          resourceLabels[kind]
            ? `当前授权范围内暂无来源${resourceLabels[kind]}`
            : undefined
        }
        emptyDescription={
          resourceLabels[kind]
            ? "可切换本地业务档案查看已有登记；来源连接失败时会显示具体错误。"
            : undefined
        }
        columns={[
          {
            key: "title",
            label:
              kind === "people"
                ? "姓名"
                : resourceLabels[kind]
                  ? `${resourceLabels[kind]}名称`
                  : "来源记录",
            render: entityName,
          },
          {
            key: "sourceSystem",
            label: "来源系统",
            render: (r) => String(r.sourceSystem || r.system || "来源库"),
          },
          {
            key: "sourceStatus",
            label: kind === "people" ? "4A 账号状态" : "来源状态",
            render: (r) => String(r.sourceStatus || "未知"),
          },
          {
            key:
              kind === "people" ? "sourceOrganizationName" : "sourceDeviceId",
            label: kind === "people" ? "来源组织" : "关联设备",
            render: (r) =>
              kind === "people"
                ? String(
                    r.sourceOrganizationName || r.sourceOrganizationCode || "—",
                  )
                : associatedDevices(r),
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
          className={kind === "routes" ? "source-route-modal" : ""}
        >
          {kind === "routes" && (
            <SourceRoutePreview
              key={selected.id}
              record={selected}
              onOpenLocalArchive={
                onOpenLocalArchive
                  ? (record) => {
                      setSelected(null);
                      onOpenLocalArchive(record);
                    }
                  : undefined
              }
            />
          )}
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
                    : key === "qualificationStatus" && val === "UNKNOWN"
                      ? "待核验"
                      : /At$|Time$/.test(key)
                        ? dateTime(val)
                        : typeof val === "object"
                          ? JSON.stringify(val)
                          : String(val),
              }))}
          />
          <p className="footnote">
            {resourceNotes[kind] ||
              "保留来源状态及时间。识别记录需人工复核，来源执行状态独立于本平台的任务办理进度。"}
          </p>
        </Modal>
      )}
    </>
  );
}
