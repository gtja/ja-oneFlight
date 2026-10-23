import { useState } from "react";
import "./experience.css";
import type { Navigate } from "../navigation";
import {
  ArrowRight,
  Boxes,
  Database,
  FileText,
  Plus,
  Radio,
  Upload,
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
import DeviceDetails from "../components/DeviceDetails";
import FlightMap from "../components/FlightMap";
import AirspaceImport from "./resources/AirspaceImport";
import { airspaceHeightLabel } from "../geometry";
import { summarizeFlightTotals } from "../flightStatistics";
import {
  resourceKinds as kinds,
  sourceCatalogs,
  deviceTypeOptions,
  schedulingLabel,
  resourceFields,
} from "./resources/config";
import { resourceColumns } from "./resources/columns";
import { resourceDetails, resourceMetadataDetails } from "./resources/details";
import {
  Button,
  DataTable,
  Details,
  EntityForm,
  ListFooter,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Status,
  Unavailable,
} from "../components/UI";
export default function Resources({ navigate }: { navigate?: Navigate }) {
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
  const [importOpen, setImportOpen] = useState(false);
  const sourceCatalogKind = manage && remote ? sourceCatalogs[kind] : undefined;
  const local = useList(
    "/resources",
    { kind, keyword: search },
    !["FLIGHT", "MEDIA"].includes(kind) &&
      !(kind === "DEVICE" && remote) &&
      !sourceCatalogKind,
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
    kind === "DEVICE" || kind === "FLIGHT" || kind === "MAINTENANCE",
  );
  const dispatchCatalog = useCatalog(
    "/resources",
    { kind: "DEVICE" },
    kind === "DEVICE",
  );
  const connectedIds = new Set(
    (catalog.data?.items || []).map((device) => device.id),
  );
  const dispatchBySource = new Map<string, Entity>();
  let schedulableDevices = 0;
  let pendingDevices = 0;
  for (const resource of dispatchCatalog.data?.items || []) {
    const sourceDeviceId = String(resource.sourceDeviceId);
    if (resource.sourceDeviceId) dispatchBySource.set(sourceDeviceId, resource);
    if (connectedIds.has(sourceDeviceId)) {
      if (resource.status === "ACTIVE") schedulableDevices += 1;
      if (resource.status === "PENDING_CONFIRMATION") pendingDevices += 1;
    }
  }
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
  const organizations = useCatalog(
    "/organizations",
    {},
    manage && (!!form || importOpen),
  );
  const mutate = useMutationFeedback();
  const query =
    kind === "FLIGHT"
      ? flights
      : kind === "MEDIA"
        ? files
        : remote && kind === "DEVICE"
          ? source
          : local;
  const normalizedSearch = search.trim().toLowerCase();
  const rows = (query.data?.items || []).filter(
    (r) =>
      (kind !== "FLIGHT" && kind !== "MEDIA") ||
      !search ||
      [entityName(r), r.id, r.deviceId, r.sortieNo, r.fileName].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(normalizedSearch),
      ),
  );
  const fields = resourceFields({
    kind,
    organizations: organizations.data?.items || [],
    devices: catalog.data?.items || [],
    dispatchBySource,
    form,
  });
  return (
    <div className="page resources-page experience-page">
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
              setRemote(manage);
              setSearch("");
              setSelected(null);
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
                setRemote(manage && !!sourceCatalogs[k]);
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
              <p>
                {sourceCatalogKind
                  ? "来源目录"
                  : `${query.data?.total ?? "—"} 条${sourceCatalogs[kind] ? "本地业务" : ""}档案`}
              </p>
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
            {manage && sourceCatalogs[kind] && (
              <div className="segmented" aria-label="资源数据来源">
                <button
                  className={remote ? "active" : ""}
                  onClick={() => {
                    setRemote(true);
                    setSelected(null);
                  }}
                >
                  来源目录
                </button>
                <button
                  className={!remote ? "active" : ""}
                  onClick={() => {
                    setRemote(false);
                    setSelected(null);
                  }}
                >
                  本地业务档案
                </button>
              </div>
            )}
            {manage &&
              !["FLIGHT", "MEDIA"].includes(kind) &&
              !(kind === "DEVICE" && remote) &&
              !sourceCatalogKind && (
                <Button primary onClick={() => setForm(true)}>
                  <Plus size={14} />
                  登记资源
                </Button>
              )}
            {manage && kind === "AIRSPACE" && !sourceCatalogKind && (
              <Button onClick={() => setImportOpen(true)}>
                <Upload size={14} />
                批量导入
              </Button>
            )}
          </div>
          {kind === "DEVICE" && (
            <>
              <p className="notice" aria-label="设备接入与调度说明">
                已接入 {catalog.data?.total ?? "—"} 台 · 可调度{" "}
                {dispatchCountsReady ? schedulableDevices : "—"}台 · 待确认{" "}
                {dispatchCountsReady ? pendingDevices : "—"}
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
          {sourceCatalogs[kind] && !sourceCatalogKind && (
            <p className="notice">
              此处展示本地登记及已导入的业务档案。
              {manage
                ? "可切换来源目录查看当前授权设备及关联组织范围内的来源记录。"
                : "来源目录由平台管理员和调度人员按授权范围查看。"}
            </p>
          )}
          {!sourceCatalogKind && (
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
                    options={deviceTypeOptions}
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
          )}
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
          {sourceCatalogKind ? (
            <SourceRecords
              key={sourceCatalogKind}
              kind={sourceCatalogKind}
              onOpenLocalArchive={
                kind === "ROUTE"
                  ? (record) => {
                      setRemote(false);
                      setSearch(entityName(record));
                      setSelected(null);
                    }
                  : undefined
              }
            />
          ) : kind === "MEDIA" && sourceMedia ? (
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
                columns={resourceColumns(kind, remote, dispatchStatus)}
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
            {organizations.isLoading && <p role="status">正在读取业务组织…</p>}
            {organizations.error && (
              <p className="form-error" role="alert">
                业务组织读取失败：{organizations.error.message}
                <Button small onClick={() => void organizations.refetch()}>
                  重试组织目录
                </Button>
              </p>
            )}
            <fieldset
              disabled={!organizations.data}
              style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            >
              <EntityForm
                fields={fields}
                notice={
                  kind === "DEVICE"
                    ? "业务所属组织用于本平台任务分配，设备与任务须属于同一组织。"
                    : undefined
                }
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
                              (form.metadata as Record<string, unknown>)
                                .geometry,
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
                  if (
                    kind === "AIRSPACE" &&
                    body.airspaceProfile !== undefined
                  ) {
                    data.metadata = {
                      ...(data.metadata as object),
                      airspaceProfile: body.airspaceProfile,
                    };
                  }
                  delete data.airspaceProfile;
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
            </fieldset>
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
          {!(kind === "DEVICE" && remote) && (
            <Details items={resourceDetails(selected, kind)} />
          )}
          {kind === "AIRSPACE" && (
            <section className="section">
              <h3>空域范围</h3>
              <p>
                高度范围：
                {airspaceHeightLabel(
                  (selected.metadata as Record<string, unknown> | undefined)
                    ?.airspaceProfile,
                )}
              </p>
              {!!(selected.metadata as Record<string, unknown> | undefined)
                ?.geometry && (
                <div
                  style={{
                    height: 320,
                    position: "relative",
                    overflow: "hidden",
                    borderRadius: 7,
                  }}
                >
                  <FlightMap
                    compact
                    initialThreeD={false}
                    objects={[selected]}
                    focusObject={selected}
                    selectedObjectId={selected.id}
                  />
                </div>
              )}
            </section>
          )}
          {!!selected.metadata && (
            <section className="section">
              <h3>档案信息</h3>
              <Details
                items={resourceMetadataDetails(
                  selected.metadata as Record<string, unknown>,
                )}
              />
            </section>
          )}
          <Provenance record={selected} />
          {kind === "DEVICE" &&
            navigate &&
            ["ADMIN", "DISPATCH", "PILOT"].includes(user.role) &&
            !!(remote ? selected.id : selected.sourceDeviceId) && (
              <Button
                onClick={() =>
                  navigate("flight", {
                    deviceId: String(
                      remote ? selected.id : selected.sourceDeviceId,
                    ),
                  })
                }
              >
                选择关联任务并检查飞控入口 <ArrowRight size={13} />
              </Button>
            )}
          {selectedDevice ? (
            <DeviceDetails device={selectedDevice} />
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
      {importOpen && manage && kind === "AIRSPACE" && (
        <AirspaceImport
          key={user.id}
          organizations={organizations.data?.items || []}
          organizationId={user.organizationId}
          organizationError={organizations.error}
          onClose={() => setImportOpen(false)}
          onImported={async (result) => {
            setRemote(false);
            setSelected(null);
            setSearch("");
            await mutate(
              () => Promise.resolve(result),
              `空域导入完成：新增 ${result.imported} 条，跳过 ${result.skipped} 条`,
            );
          }}
        />
      )}
    </div>
  );
}
