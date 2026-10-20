import { useState } from "react";
import {
  ArrowRight,
  Boxes,
  Database,
  FileText,
  Plus,
  Radio,
  Users,
  Wrench,
} from "lucide-react";
import {
  entityName,
  useCatalog,
  useDevices,
  useList,
  write,
  type Entity,
} from "../api";
import { dateTime, metersLabel, REGIONS, secondsLabel } from "../domain";
import { useUser } from "../context";
import { Provenance, useMutationFeedback } from "../components/Workflow";
import SourceRecords from "../components/SourceRecords";
import DeviceFlightHistory from "../components/DeviceFlightHistory";
import { getFlightTotals, summarizeFlightTotals } from "../flightStatistics";
import {
  Button,
  DataTable,
  Details,
  Empty,
  EntityForm,
  ListFooter,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Status,
  Unavailable,
  type Field,
} from "../components/UI";
const kinds: Record<string, string> = {
  DEVICE: "设备资源",
  PERSON: "人员资源",
  ROUTE: "航线资源",
  AIRSPACE: "空域资源",
  MAINTENANCE: "设备维护",
  FLIGHT: "飞行记录",
  MEDIA: "成果媒体",
};
const schedulingLabel = (status?: string) =>
  status === "ACTIVE"
    ? "可调度"
    : status === "PENDING_CONFIRMATION"
      ? "待确认"
      : undefined;
export default function Resources() {
  const user = useUser();
  const manage = ["ADMIN", "DISPATCH"].includes(user.role);
  const [kind, setKind] = useState("DEVICE");
  const [remote, setRemote] = useState(true);
  const [sourceMedia, setSourceMedia] = useState(false);
  const [deviceType, setDeviceType] = useState("");
  const [statisticsOnly, setStatisticsOnly] = useState("");
  const [flightDeviceId, setFlightDeviceId] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [form, setForm] = useState<Entity | boolean | null>(null);
  const local = useList(
    "/resources",
    { kind, keyword: search },
    !["FLIGHT", "MEDIA"].includes(kind) && !(kind === "DEVICE" && remote),
  );
  const source = useList(
    "/devices",
    {
      keyword: search,
      type: deviceType,
      hasFlightTotals: statisticsOnly || undefined,
    },
    kind === "DEVICE" && remote,
  );
  const catalog = useDevices(
    kind === "DEVICE" || kind === "FLIGHT" || kind === "MAINTENANCE" || !!form,
  );
  const dispatchCatalog = useCatalog(
    "/resources",
    { kind: "DEVICE" },
    kind === "DEVICE",
  );
  const dispatchBySource = new Map(
    (dispatchCatalog.data?.items || [])
      .filter((resource) => !!resource.sourceDeviceId)
      .map((resource) => [String(resource.sourceDeviceId), resource]),
  );
  const connectedIds = new Set(
    (catalog.data?.items || []).map((device) => device.id),
  );
  const connectedArchives = (dispatchCatalog.data?.items || []).filter(
    (resource) => connectedIds.has(String(resource.sourceDeviceId)),
  );
  const dispatchCountsReady = !!catalog.data && !!dispatchCatalog.data;
  const selectedArchive =
    kind === "DEVICE" && remote && selected
      ? dispatchBySource.get(selected.id)
      : undefined;
  const selectedDevice =
    kind === "DEVICE" && selected
      ? remote
        ? selected
        : catalog.data?.items.find(
            (device) => device.id === selected.sourceDeviceId,
          )
      : undefined;
  const dispatchStatus = (deviceId: string) => {
    if (dispatchCatalog.error) return <span className="muted">读取失败</span>;
    if (!dispatchCatalog.data) return <span className="muted">加载中</span>;
    const archive = dispatchBySource.get(deviceId);
    return archive ? (
      <Status status={archive.status} label={schedulingLabel(archive.status)} />
    ) : (
      <span className="muted">待登记</span>
    );
  };
  const summary = summarizeFlightTotals(catalog.data?.items || []);
  const flights = useList(
    "/flights",
    { deviceId: flightDeviceId || undefined, pageSize: 20 },
    kind === "FLIGHT",
  );
  const files = useList("/attachments", {}, kind === "MEDIA");
  const organizations = useList("/organizations");
  const mutate = useMutationFeedback();
  const query =
    kind === "FLIGHT"
      ? flights
      : kind === "MEDIA"
        ? files
        : remote && kind === "DEVICE"
          ? source
          : local;
  const rows = (query.data?.items || []).filter(
    (r) =>
      (kind !== "FLIGHT" && kind !== "MEDIA") ||
      !search ||
      [entityName(r), r.id, r.deviceId, r.sortieNo, r.fileName].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
      ),
  );
  const fields: Field[] = [
    {
      key: "organizationId",
      label: "所属组织",
      required: true,
      options: (organizations.data?.items || []).map((r) => ({
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
            options: (catalog.data?.items || [])
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
                options: (catalog.data?.items || []).map((r) => ({
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
  return (
    <div className="page">
      <PageHeader title="资源管理" subtitle="设备、人员与数据档案统一管理" />
      <div className="resource-layout">
        <aside className="resource-catalog">
          <div className="catalog-title">
            <Database size={16} />
            资源目录
          </div>
          <h4>
            <Boxes size={14} />
            设备资源
          </h4>
          {["DEVICE", "MAINTENANCE"].map((k) => (
            <button
              className={kind === k ? "active" : ""}
              key={k}
              onClick={() => {
                setKind(k);
                setRemote(k === "DEVICE");
                setSearch("");
                setSelected(null);
              }}
            >
              {k === "MAINTENANCE" ? <Wrench size={14} /> : <Radio size={14} />}{" "}
              {kinds[k]}
            </button>
          ))}
          <h4>
            <Users size={14} />
            人员资源
          </h4>
          <button
            className={kind === "PERSON" ? "active" : ""}
            onClick={() => {
              setKind("PERSON");
              setRemote(false);
            }}
          >
            人员档案
          </button>
          <h4>
            <Database size={14} />
            数据资源
          </h4>
          {["ROUTE", "AIRSPACE", "FLIGHT", "MEDIA"].map((k) => (
            <button
              className={kind === k ? "active" : ""}
              key={k}
              onClick={() => {
                setKind(k);
                setRemote(false);
                setSearch("");
                setSelected(null);
              }}
            >
              <FileText size={13} />
              {kinds[k]}
            </button>
          ))}
        </aside>
        <div className="resource-main">
          <div className="table-toolbar">
            <div>
              <h2>{kinds[kind]}</h2>
              <p>{query.data?.total ?? "—"} 条档案</p>
            </div>
            {kind === "DEVICE" && (
              <div className="segmented">
                <button
                  className={!remote ? "active" : ""}
                  onClick={() => setRemote(false)}
                >
                  调度档案
                </button>
                <button
                  className={remote ? "active" : ""}
                  onClick={() => setRemote(true)}
                >
                  设备总览
                </button>
              </div>
            )}
            {manage &&
              !["FLIGHT", "MEDIA"].includes(kind) &&
              !(kind === "DEVICE" && remote) && (
                <Button primary onClick={() => setForm(true)}>
                  <Plus size={14} />
                  登记资源
                </Button>
              )}
          </div>
          {kind === "DEVICE" && (
            <>
              <p className="notice" aria-label="设备接入与调度说明">
                已接入 {catalog.data?.total ?? "—"} 台 · 可调度{" "}
                {dispatchCountsReady
                  ? connectedArchives.filter(
                      (resource) => resource.status === "ACTIVE",
                    ).length
                  : "—"}
                台 · 待确认{" "}
                {dispatchCountsReady
                  ? connectedArchives.filter(
                      (resource) => resource.status === "PENDING_CONFIRMATION",
                    ).length
                  : "—"}
                台。接入后可查看设备数据；完善调度资料后，在任务调度中选择设备和飞手。
              </p>
              {dispatchCatalog.error && (
                <p className="form-error">
                  调度资料读取失败：{dispatchCatalog.error.message}
                  。重新加载后可继续完善。
                </p>
              )}
            </>
          )}
          <div className="filter-bar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="搜索资源名称、编号或型号"
            />
            {kind === "DEVICE" && remote && (
              <>
                <Select
                  label="设备类型"
                  value={deviceType}
                  onChange={setDeviceType}
                  options={[
                    { value: "", label: "全部设备类型" },
                    { value: "UAV", label: "飞机" },
                    { value: "UAV_AIRPORT", label: "机巢" },
                    { value: "AI_POD", label: "算力舱" },
                    { value: "CAMERA", label: "摄像机" },
                    { value: "RADAR", label: "雷达" },
                  ]}
                />
                <Select
                  label="飞行统计筛选"
                  value={statisticsOnly}
                  onChange={setStatisticsOnly}
                  options={[
                    { value: "", label: "全部设备" },
                    { value: "true", label: "有飞行统计" },
                  ]}
                />
              </>
            )}
            {kind === "FLIGHT" && (
              <Select
                label="飞行记录设备"
                value={flightDeviceId}
                onChange={setFlightDeviceId}
                options={[
                  { value: "", label: "全部设备的飞行记录" },
                  ...(catalog.data?.items || [])
                    .filter((r) => r.type === "UAV")
                    .map((r) => ({ value: r.id, label: entityName(r) })),
                ]}
              />
            )}
          </div>
          {kind === "DEVICE" && remote && (
            <>
              <div
                className="resource-flight-stats"
                aria-label="设备累计飞行汇总"
              >
                <div>
                  <span>已上报累计统计</span>
                  <strong>
                    {catalog.data ? summary.devicesWithStatistics : "—"}
                    <small>台设备</small>
                  </strong>
                </div>
                <div>
                  <span>累计飞行架次</span>
                  <strong>
                    {summary.sorties ?? "未知"}
                    <small>架次</small>
                  </strong>
                </div>
                <div>
                  <span>累计飞行时长</span>
                  <strong>{secondsLabel(summary.timeSeconds)}</strong>
                </div>
                <div>
                  <span>累计飞行距离</span>
                  <strong>{metersLabel(summary.distanceMeters)}</strong>
                </div>
              </div>
              {catalog.error && (
                <p className="form-error">
                  累计统计暂不可用：{catalog.error.message}
                </p>
              )}
              <p className="footnote">
                设备总览展示来源观测，调度档案管理本地可用状态。已登记的设备可直接完善原档案；累计值仅汇总已上报统计的设备。
              </p>
            </>
          )}
          {kind === "MEDIA" && manage && (
            <div className="segmented">
              <button
                className={!sourceMedia ? "active" : ""}
                onClick={() => setSourceMedia(false)}
              >
                成果档案
              </button>
              <button
                className={sourceMedia ? "active" : ""}
                onClick={() => setSourceMedia(true)}
              >
                来源媒体
              </button>
            </div>
          )}
          {kind === "MEDIA" && sourceMedia ? (
            <SourceRecords kind="media" />
          ) : (
            <>
              <DataTable
                rows={rows}
                onRow={setSelected}
                loading={query.isLoading}
                error={query.error}
                emptyTitle={
                  kind === "MAINTENANCE"
                    ? "尚未登记维护记录"
                    : kind === "PERSON"
                      ? "尚未登记人员档案"
                      : kind === "DEVICE" && !remote
                        ? "尚未登记调度档案"
                        : undefined
                }
                emptyDescription={
                  kind === "MAINTENANCE"
                    ? "已接入的数据源未提供维护记录，可选择现有设备登记维护时间与说明。"
                    : kind === "DEVICE" && !remote
                      ? "在设备总览中查看已接入设备，并登记需要参与任务分配的设备。"
                      : kind === "PERSON"
                        ? "人员资格和维护事项需要在本平台登记，设备接入不会自动生成人员档案。"
                        : undefined
                }
                columns={
                  kind === "FLIGHT"
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
                            render: (r) =>
                              ({
                                UAV: "飞机",
                                UAV_AIRPORT: "机巢",
                                AI_POD: "算力舱",
                                CAMERA: "摄像机",
                                RADAR: "雷达",
                              })[String(r.type)] || String(r.type || "未知"),
                          },
                          { key: "sn", label: "序列号" },
                          {
                            key: "sorties",
                            label: "累计飞行架次",
                            render: (r) =>
                              getFlightTotals(r)?.sorties ?? "未知",
                          },
                          {
                            key: "timeSeconds",
                            label: "累计飞行时长",
                            render: (r) =>
                              secondsLabel(getFlightTotals(r)?.timeSeconds),
                          },
                          {
                            key: "distanceMeters",
                            label: "累计飞行距离",
                            render: (r) =>
                              metersLabel(getFlightTotals(r)?.distanceMeters),
                          },
                          {
                            key: "status",
                            label: "来源状态",
                            render: (r) => <Status status={r.status} />,
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
                                统计 / 飞行记录 <ArrowRight size={12} />
                              </span>
                            ),
                          },
                        ]
                      : kind === "MEDIA"
                        ? [
                            { key: "fileName", label: "文件名称" },
                            { key: "contentType", label: "文件类型" },
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
                                String(
                                  r.type ||
                                    kinds[String(r.kind)] ||
                                    kinds[kind],
                                ),
                            },
                            { key: "region", label: "所属区域" },
                            { key: "model", label: "型号 / 资质" },
                            {
                              key: "status",
                              label: kind === "DEVICE" ? "调度状态" : "状态",
                              render: (r) => (
                                <Status
                                  status={r.status}
                                  label={
                                    kind === "DEVICE"
                                      ? schedulingLabel(r.status)
                                      : undefined
                                  }
                                />
                              ),
                            },
                            {
                              key: "details",
                              label: "操作",
                              render: () => (
                                <span className="text-link">查看档案</span>
                              ),
                            },
                          ]
                }
              />
              <ListFooter page={query.data} onChange={query.setPage} />
            </>
          )}
          {kind === "FLIGHT" && (
            <p className="footnote">
              当前显示来源架次统计。上报时间与任务执行时间分别记录，起降时刻未知时保持为空。
            </p>
          )}
        </div>
      </div>
      {form && (
        <Modal
          className={
            kind === "ROUTE" || kind === "AIRSPACE"
              ? "spatial-resource-modal"
              : ""
          }
          title={
            kind === "DEVICE"
              ? "完善调度资料"
              : typeof form === "object" && form.id
                ? "编辑资源档案"
                : `登记${kinds[kind]}`
          }
          onClose={() => setForm(null)}
        >
          <div data-resource-id={typeof form === "object" ? form.id : ""}>
            <EntityForm
              fields={fields}
              initial={
                typeof form === "object"
                  ? {
                      ...form,
                      ...(form.metadata as object),
                      id: form.id,
                      title: form.title,
                      organizationId: form.organizationId,
                      region: form.region,
                      status: form.status,
                      sourceDeviceId: form.sourceDeviceId,
                      ...(kind === "DEVICE" &&
                      !REGIONS.includes(String(form.region))
                        ? { region: "" }
                        : {}),
                      geometry: (
                        form.metadata as Record<string, unknown> | undefined
                      )?.geometry
                        ? JSON.stringify(
                            (form.metadata as Record<string, unknown>).geometry,
                          )
                        : "",
                    }
                  : { status: "ACTIVE", organizationId: user.organizationId }
              }
              onCancel={() => setForm(null)}
              onSubmit={(body) => {
                const data: Record<string, unknown> = {
                  ...body,
                  kind,
                  metadata: {
                    ...(typeof form === "object"
                      ? (form.metadata as object)
                      : {}),
                    description: body.description,
                    maintenanceAt: body.maintenanceAt,
                    deviceId: body.deviceId,
                  },
                };
                if (body.geometry) {
                  data.metadata = {
                    ...(data.metadata as object),
                    geometry:
                      typeof body.geometry === "string"
                        ? JSON.parse(body.geometry)
                        : body.geometry,
                    geometryContext: body.geometryContext,
                  };
                  delete data.geometry;
                }
                delete data.geometryContext;
                const original = catalog.data?.items.find(
                  (r) => r.id === body.sourceDeviceId,
                );
                if (original) {
                  data.productKey = original.productKey;
                  data.sn = body.sn || original.sn;
                  data.longitude = body.longitude ?? original.longitude;
                  data.latitude = body.latitude ?? original.latitude;
                }
                return mutate(
                  () =>
                    write(
                      `/resources${typeof form === "object" && form.id ? `/${form.id}` : ""}`,
                      data,
                      typeof form === "object" && form.id ? "PUT" : "POST",
                    ),
                  "资源档案已保存",
                );
              }}
            />
          </div>
        </Modal>
      )}
      {selected && (
        <Modal
          title={entityName(selected)}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="detail-heading">
            <span className="mono">{selected.id}</span>
            {kind === "DEVICE" && remote ? (
              <span>
                来源状态 <Status status={selected.status} />
              </span>
            ) : (
              <Status
                status={selected.status}
                label={
                  kind === "DEVICE"
                    ? schedulingLabel(selected.status)
                    : undefined
                }
              />
            )}
          </div>
          {kind === "DEVICE" && remote && (
            <section className="section">
              <h3>调度资料</h3>
              <Details
                items={[
                  { label: "设备接入", value: "已接入" },
                  { label: "本地调度状态", value: dispatchStatus(selected.id) },
                  {
                    label: "调度区域",
                    value:
                      selectedArchive?.region &&
                      selectedArchive.region !== "来源未提供"
                        ? String(selectedArchive.region)
                        : "待完善",
                  },
                  {
                    label: "下一步",
                    value:
                      selectedArchive?.status === "ACTIVE"
                        ? "前往任务调度，分配设备和飞手。"
                        : "完善所属区域与调度状态，再分配任务。",
                  },
                ]}
              />
            </section>
          )}
          <Details
            items={Object.entries(selected)
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
                label:
                  (
                    {
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
                    } as Record<string, string>
                  )[key] || key,
                value:
                  v === null
                    ? "未知"
                    : typeof v === "object"
                      ? JSON.stringify(v)
                      : String(v),
              }))}
          />
          {!!selected.metadata && (
            <section className="section">
              <h3>档案信息</h3>
              <Details
                items={Object.entries(
                  selected.metadata as Record<string, unknown>,
                )
                  .filter(([key]) =>
                    [
                      "description",
                      "sourceOrganizationName",
                      "sourceOrganizationCode",
                      "qualificationStatus",
                      "qualificationNote",
                      "maintenanceAt",
                      "deviceId",
                      "geometryStatus",
                      "coordinateReference",
                      "scopeNote",
                      "sourceCreatedAt",
                      "sourceUpdatedAt",
                    ].includes(key),
                  )
                  .map(([key, val]) => ({
                    label:
                      (
                        {
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
                        } as Record<string, string>
                      )[key] || key,
                    value:
                      val == null
                        ? "未知"
                        : key === "qualificationStatus" && val === "UNKNOWN"
                          ? "待核验"
                          : key === "coordinateReference" &&
                              val === "SOURCE_MAP_UNSPECIFIED"
                            ? "来源未说明"
                            : String(val),
                  }))}
              />
            </section>
          )}
          <Provenance record={selected} />
          {selectedDevice ? (
            <DeviceFlightHistory device={selectedDevice} />
          ) : kind === "DEVICE" && selected.sourceDeviceId ? (
            <section className="section">
              <h3>设备飞行记录</h3>
              {catalog.error ? (
                <p className="form-error">
                  来源设备目录读取失败：{catalog.error.message}
                  。暂无法核对关联设备，请刷新后重试。
                </p>
              ) : !catalog.data ? (
                <p className="muted">
                  正在核对关联来源设备，完成后展示飞行记录。
                </p>
              ) : (
                <p className="muted">
                  关联的来源设备当前不可见，可能已移除或授权范围发生变化。请核对设备接入和当前账号可见范围。
                </p>
              )}
            </section>
          ) : (
            !!selected.flightTotals && (
              <section className="section">
                <h3>来源累计飞行统计</h3>
                <Details
                  items={[
                    {
                      label: "累计架次",
                      value: String(
                        (selected.flightTotals as Record<string, unknown>)
                          .sorties ?? "未知",
                      ),
                    },
                    {
                      label: "累计时长",
                      value: secondsLabel(
                        (selected.flightTotals as Record<string, unknown>)
                          .timeSeconds,
                      ),
                    },
                    {
                      label: "累计距离",
                      value: metersLabel(
                        (selected.flightTotals as Record<string, unknown>)
                          .distanceMeters,
                      ),
                    },
                    {
                      label: "统计上报时间",
                      value: dateTime(
                        (selected.flightTotals as Record<string, unknown>)
                          .reportedAt,
                      ),
                    },
                  ]}
                />
              </section>
            )
          )}
          {kind === "FLIGHT" && (
            <Unavailable
              title="完整历史轨迹及媒体来源待接通"
              description="保留原始架次记录，不拼接零散坐标生成历史轨迹。"
            />
          )}
          {kind === "MEDIA" && (
            <a
              className="button primary"
              href={`/api/v1/attachments/${selected.id}/content`}
              target="_blank"
              rel="noreferrer"
            >
              预览 / 下载文件
            </a>
          )}
          {manage && !remote && !["FLIGHT", "MEDIA"].includes(kind) && (
            <Button
              primary
              onClick={() => {
                setForm(selected);
                setSelected(null);
              }}
            >
              编辑档案
            </Button>
          )}
          {manage && kind === "DEVICE" && remote && (
            <Button
              primary
              disabled={!dispatchCatalog.data || !!dispatchCatalog.error}
              onClick={() => {
                setForm(
                  selectedArchive || {
                    id: "",
                    organizationId: user.organizationId,
                    title: entityName(selected),
                    region: "",
                    status: "ACTIVE",
                    sourceDeviceId: selected.id,
                    sn: selected.sn,
                    longitude: selected.longitude,
                    latitude: selected.latitude,
                  },
                );
                setSelected(null);
              }}
            >
              {selectedArchive ? "完善调度资料" : "登记调度资料"}
            </Button>
          )}
        </Modal>
      )}
    </div>
  );
}
