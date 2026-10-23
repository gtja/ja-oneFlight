import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crosshair,
  Database,
  Layers3,
  MapPin,
  Plane,
  Radio,
  RefreshCw,
  Route,
  ShieldCheck,
  ShieldAlert,
  TowerControl,
  X,
} from "lucide-react";
import { entityName, readCatalog, useDevices, type Entity } from "../api";
import { dateTime, REGIONS } from "../domain";
import { summarizeFlightTotals } from "../flightStatistics";
import { deviceObservationStatus } from "../flightDeviceOrder";
import { resolveDevicePresentation } from "../devicePresentation";
import {
  commandRecordGroups,
  type CommandRecordKey,
} from "../commandBoardRecords";
import type { Navigate } from "../navigation";
import FlightMap from "../components/FlightMap";
import { HourlyChart, RegionalChart } from "../components/CommandTaskCharts";
import CommandRecordList from "../components/CommandRecordList";
import { hasMapObjectLocation } from "../components/mapObjectFocus";
import { Button, Details, Modal, Select, Status } from "../components/UI";
import "./CommandBoard.css";

const SITE_TYPES = ["DOCK", "AIRPORT", "LANDING_SITE", "UAV_AIRPORT"];
const DETECTOR_TYPES = ["RADAR", "DETECTOR"];
const layerLabels = {
  airspace: "空域与航线",
  sites: "起降点",
  devices: "航空器",
  detectors: "探测设备",
  equipment: "其他设备",
};
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  hourCycle: "h23",
});
const number = (value: number | null | undefined, digits = 0) =>
  value == null
    ? "—"
    : value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
const kindOf = (item: Entity) => String(item.type || item.kind || "");
const objectKindLabel = (item: Entity) =>
  item.kind === "AIRSPACE"
    ? "保障空域"
    : item.kind === "ROUTE"
      ? "飞行航线"
      : resolveDevicePresentation(item).label;
const layerOf = (
  item: Entity,
): "airspace" | "sites" | "devices" | "detectors" | "equipment" =>
  ["AIRSPACE", "ROUTE"].includes(String(item.kind))
    ? "airspace"
    : resolveDevicePresentation(item).layer;

function useBoardCatalog(path: string) {
  const result = useQuery({
    queryKey: ["catalog", path, ""],
    queryFn: () => readCatalog(path),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return { ...result, data: result.isError ? undefined : result.data };
}

function Panel({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`command-panel ${className}`}>
      <div className="command-panel-heading">
        <h2>{title}</h2>
        <span className="command-heading-line" />
        {action}
      </div>
      {children}
    </section>
  );
}

export default function CommandBoard({ navigate }: { navigate: Navigate }) {
  const [region, setRegion] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [info, setInfo] = useState(false);
  const [taskDrilldown, setTaskDrilldown] = useState<
    { kind: "hour"; hour: number } | { kind: "region"; region: string } | null
  >(null);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [recordKey, setRecordKey] = useState<CommandRecordKey | null>(null);
  const [caseDetail, setCaseDetail] = useState<Entity | null>(null);
  const [resourceDetail, setResourceDetail] = useState(false);
  const [feedInfo, setFeedInfo] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState("");
  const [focusRequest, setFocusRequest] = useState<{
    entity: Entity;
    revision: number;
  }>();
  const focusRevision = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [layers, setLayers] = useState({
    airspace: true,
    sites: true,
    devices: true,
    detectors: true,
    equipment: true,
  });
  useEffect(() => {
    if (!refreshResult) return;
    const timer = window.setTimeout(() => setRefreshResult(""), 6000);
    return () => window.clearTimeout(timer);
  }, [refreshResult]);
  const devices = useDevices();
  const resources = useBoardCatalog("/resources");
  const tasks = useBoardCatalog("/tasks");
  const cases = useBoardCatalog("/cases");
  const plans = useBoardCatalog("/plans");
  const selectMapObject = useCallback((entity: Entity) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelected(entity);
    setRecordKey(null);
    setLayers((current) => ({ ...current, [layerOf(entity)]: true }));
    setFocusRequest(
      hasMapObjectLocation(entity)
        ? { entity, revision: ++focusRevision.current }
        : undefined,
    );
  }, []);
  const closeMapObject = useCallback(() => {
    setSelected(null);
    setResourceDetail(false);
    setFocusRequest(undefined);
    const previous = returnFocus.current;
    if (previous?.isConnected) previous.focus();
    else
      document
        .querySelector<HTMLElement>(".command-board-map .maplibregl-canvas")
        ?.focus();
  }, []);
  useEffect(() => {
    if (!selected) return;
    const closeInspector = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      closeMapObject();
    };
    document.addEventListener("keydown", closeInspector);
    return () => document.removeEventListener("keydown", closeInspector);
  }, [selected, closeMapObject]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const day = dayFormatter.format(now);
  const data = useMemo(() => {
    const local = resources.data?.items;
    const regionByDevice = new Map(
      local
        ?.filter((item) => item.sourceDeviceId)
        .map((item) => [String(item.sourceDeviceId), item.region]),
    );
    const scoped = (items: Entity[] | undefined) =>
      items?.filter((item) => !region || item.region === region);
    const fleet =
      devices.data && (!region || local)
        ? devices.data.items
            .map((device) => ({
              ...device,
              region: regionByDevice.get(device.id) || device.region,
            }))
            .filter((device) => !region || device.region === region)
        : undefined;
    const localResources = scoped(local);
    const scopedTasks = scoped(tasks.data?.items);
    const scopedCases = scoped(cases.data?.items);
    const scopedPlans = scoped(plans.data?.items);
    const currentTasks = scopedTasks?.filter(
      (item) => item.status === "EXECUTING",
    );
    const openCases = scopedCases?.filter((item) => item.status !== "ARCHIVED");
    const objects = [
      ...(fleet || []),
      ...(localResources || []).filter(
        (item) =>
          !item.sourceDeviceId &&
          [
            "DEVICE",
            "ROUTE",
            "AIRSPACE",
            ...SITE_TYPES,
            ...DETECTOR_TYPES,
          ].includes(String(item.kind)),
      ),
    ];
    const aircraft = fleet?.filter((item) => kindOf(item) === "UAV");
    const sites =
      fleet && localResources
        ? [
            ...fleet,
            ...localResources.filter((item) => !item.sourceDeviceId),
          ].filter((item) => SITE_TYPES.includes(kindOf(item)))
        : undefined;
    const todayTasks = scopedTasks?.filter((item) => {
      if (!item.startAt || item.status === "CANCELLED") return false;
      const start = new Date(String(item.startAt));
      return (
        Number.isFinite(start.getTime()) && dayFormatter.format(start) === day
      );
    });
    const hours = todayTasks ? Array.from({ length: 24 }, () => 0) : null;
    todayTasks?.forEach((item) => {
      hours![Number(hourFormatter.format(new Date(String(item.startAt))))] += 1;
    });
    const knownRegions = region ? [region] : [...REGIONS];
    if (
      todayTasks?.some(
        (item) => !item.region || !knownRegions.includes(item.region),
      )
    )
      knownRegions.push("其他/未分区");
    const regions = todayTasks
      ? knownRegions.map((name) => ({
          region: name,
          count: todayTasks.filter((item) =>
            name === "其他/未分区"
              ? !item.region || !REGIONS.includes(item.region)
              : item.region === name,
          ).length,
        }))
      : null;
    return {
      fleet,
      objects,
      aircraft,
      sites,
      localResources,
      currentTasks,
      openCases,
      scopedCases,
      scopedTasks,
      scopedPlans,
      hours,
      regions,
      todayTasks,
      totals: summarizeFlightTotals(fleet || []),
      airspaces: localResources?.filter((item) => item.kind === "AIRSPACE"),
      routes: localResources?.filter((item) => item.kind === "ROUTE"),
    };
  }, [
    devices.data,
    resources.data,
    tasks.data,
    cases.data,
    plans.data,
    region,
    day,
  ]);
  const pendingTasks = data.scopedTasks?.filter((item) =>
    ["PENDING_ASSIGNMENT", "PENDING_EXECUTION"].includes(String(item.status)),
  ).length;
  const completedTasks = data.scopedTasks?.filter(
    (item) => item.status === "COMPLETED",
  ).length;
  const online = data.fleet?.filter(
    (item) => deviceObservationStatus(item, now.getTime()) === "ONLINE",
  ).length;
  const reviewedCases = cases.data?.items.filter(
    (item) =>
      (!region || item.region === region) &&
      ["RESOLVED", "ARCHIVED"].includes(String(item.status)),
  ).length;
  const scopedCaseTotal = cases.data?.items.filter(
    (item) => !region || item.region === region,
  ).length;
  const resolvedPercent = scopedCaseTotal
    ? Math.round((reviewedCases! / scopedCaseTotal) * 100)
    : null;
  const latestRead = Math.min(
    ...[
      devices.dataUpdatedAt,
      resources.dataUpdatedAt,
      tasks.dataUpdatedAt,
      cases.dataUpdatedAt,
      plans.dataUpdatedAt,
    ].filter(Boolean),
  );
  const feedStates = [
    {
      label: "设备与遥测",
      query: devices,
      detail: devices.data
        ? `${number(data.fleet?.length)} 台可见设备`
        : "等待设备来源",
    },
    {
      label: "资源与空域",
      query: resources,
      detail: resources.data
        ? `${number(data.localResources?.length)} 项本地资源`
        : "等待资源目录",
    },
    {
      label: "任务与线索",
      query: tasks,
      detail:
        tasks.data && cases.data && plans.data
          ? "业务数据已同步"
          : "部分业务数据待同步",
      error: tasks.isError || cases.isError || plans.isError,
    },
  ];
  const kpis = [
    {
      label: "累计飞行架次",
      recordKey: "sorties" as const,
      value: number(data.totals.sorties),
      unit: "架次",
      icon: Plane,
    },
    {
      label: "累计飞行时长",
      recordKey: "timeSeconds" as const,
      value: number(
        data.totals.timeSeconds === null
          ? null
          : data.totals.timeSeconds / 3600,
        2,
      ),
      unit: "小时",
      icon: Clock3,
    },
    {
      label: "累计飞行里程",
      recordKey: "distanceMeters" as const,
      value: number(
        data.totals.distanceMeters === null
          ? null
          : data.totals.distanceMeters / 1000,
        2,
      ),
      unit: "公里",
      icon: Route,
    },
  ];
  const drilldownTasks = taskDrilldown
    ? data.todayTasks
        ?.filter((item) =>
          taskDrilldown.kind === "hour"
            ? Number(hourFormatter.format(new Date(String(item.startAt)))) ===
              taskDrilldown.hour
            : taskDrilldown.region === "其他/未分区"
              ? !item.region || !REGIONS.includes(item.region)
              : item.region === taskDrilldown.region,
        )
        .sort(
          (left, right) =>
            new Date(String(left.startAt)).getTime() -
            new Date(String(right.startAt)).getTime(),
        )
    : undefined;
  const drilldownScope = taskDrilldown
    ? taskDrilldown.kind === "hour"
      ? `${String(taskDrilldown.hour).padStart(2, "0")}:00–${String(taskDrilldown.hour).padStart(2, "0")}:59 · ${region || "全市"}`
      : taskDrilldown.region
    : "";
  const groups = commandRecordGroups(data, now.getTime());
  const recordGroup = recordKey ? groups[recordKey] : undefined;
  const recordError =
    recordGroup?.kind === "task"
      ? tasks.isError
      : recordGroup?.kind === "case"
        ? cases.isError
        : recordGroup?.kind === "plan"
          ? plans.isError
          : recordKey === "resources"
            ? resources.isError
            : devices.isError ||
              ((recordKey === "sites" || Boolean(region)) && resources.isError);
  const selectedEntity: Entity | null =
    selected &&
    (data.objects.find((item) => item.id === selected.id) || selected);
  const selectedIsDevice = data.fleet?.some(
    (device) => device.id === selected?.id,
  );
  const selectedStatus =
    selectedIsDevice && selectedEntity
      ? deviceObservationStatus(selectedEntity, now.getTime())
      : selectedEntity?.status;
  const recordStatus = (item: Entity) =>
    data.fleet?.some((device) => device.id === item.id)
      ? deviceObservationStatus(item, now.getTime())
      : item.status;
  const recordCaption = (item: Entity) =>
    [
      item.region || "未关联区域",
      item.scene,
      recordGroup?.kind === "map"
        ? objectKindLabel(item)
        : recordGroup?.kind === "case"
          ? dateTime(item.updatedAt)
          : dateTime(item.startAt),
    ]
      .filter(Boolean)
      .join(" · ");
  const readers = [devices, resources, tasks, cases, plans];
  async function refreshBoard() {
    setRefreshing(true);
    setRefreshResult("");
    try {
      const results = await Promise.allSettled(
        readers.map((query) => query.refetch()),
      );
      setRefreshResult(
        results.some(
          (result) => result.status === "rejected" || result.value.isError,
        )
          ? "部分数据同步失败，可查看各项状态后重试"
          : "当前授权范围的数据已刷新",
      );
    } finally {
      setRefreshing(false);
    }
  }
  function chooseRecord(item: Entity) {
    if (recordGroup?.kind === "map") selectMapObject(item);
    else if (recordGroup?.kind === "task")
      navigate("dispatch", { taskId: item.id });
    else if (recordGroup?.kind === "plan")
      navigate("services", { planId: item.id });
    else {
      setRecordKey(null);
      setCaseDetail(item);
    }
  }
  return (
    <div
      className={`page command-board${selected ? " has-map-selection" : ""}`}
    >
      <header className="page-header command-board-header">
        <div className="command-title">
          <span className="command-title-symbol">
            <TowerControl size={24} />
          </span>
          <div>
            <h1>低空运行指挥</h1>
            <p>全域协同 · 运行与安全态势</p>
          </div>
          <span className="command-live">
            <i />
            指挥视图
          </span>
        </div>
        <div className="header-actions command-header-actions">
          <span className="command-topic">运行总览</span>
          <MapPin size={14} />
          <Select
            label="指挥区域"
            value={region}
            onChange={(value) => {
              setRegion(value);
              setSelected(null);
              setResourceDetail(false);
              setFocusRequest(undefined);
            }}
            options={[
              { value: "", label: "全市" },
              ...REGIONS.map((name) => ({ value: name, label: name })),
            ]}
          />
          <Button
            aria-label="刷新大屏数据"
            title="立即同步当前授权数据"
            onClick={refreshBoard}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            <RefreshCw size={15} className={refreshing ? "spinning" : ""} />
            <span>{refreshing ? "同步中" : "刷新"}</span>
          </Button>
          <Button aria-label="指标口径与数据来源" onClick={() => setInfo(true)}>
            <CircleHelp size={16} />
            <span>统计口径</span>
          </Button>
        </div>
      </header>
      <div className="overview-map command-board-map">
        <FlightMap
          simulation
          objects={data.objects}
          onSelect={selectMapObject}
          selectedObjectId={selected?.id}
          focusRequest={focusRequest}
          layers={layers}
        />
        <div className="command-map-shade" />
        <div className="command-board-layout">
          <aside className="command-left">
            <Panel title="资源总量" action={<Database size={13} />}>
              <div className="command-resource-grid">
                {[
                  {
                    label: "航空器",
                    recordKey: "aircraft" as const,
                    count: data.aircraft?.length,
                    unit: "架",
                    icon: Plane,
                  },
                  {
                    label: "起降点",
                    recordKey: "sites" as const,
                    count: data.sites?.length,
                    unit: "处",
                    icon: TowerControl,
                  },
                  {
                    label: "在线设备",
                    recordKey: "online" as const,
                    count: online,
                    unit: "台",
                    icon: Radio,
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    title={`查看${item.label}明细`}
                    aria-haspopup="dialog"
                    aria-expanded={recordKey === item.recordKey}
                    className={recordKey === item.recordKey ? "is-active" : ""}
                    onClick={() => setRecordKey(item.recordKey)}
                  >
                    <item.icon size={17} />
                    <span>{item.label}</span>
                    <strong>
                      <span
                        className="command-number-value"
                        key={number(item.count)}
                      >
                        {number(item.count)}
                      </span>
                      <small>{item.unit}</small>
                    </strong>
                  </button>
                ))}
              </div>
              <p className="command-panel-footnote">
                {region || "全市"}授权范围 · 来源设备与本地目录
              </p>
            </Panel>
            <Panel
              title="运行健康"
              action={<ShieldCheck size={13} />}
              className="command-health"
            >
              <div className="command-health-grid">
                <button
                  title="查看未结线索明细"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "openCases"}
                  onClick={() => setRecordKey("openCases")}
                >
                  <span>未结线索</span>
                  <strong className="command-amber">
                    {number(data.openCases?.length)}
                  </strong>
                </button>
                <button
                  title="查看已归档/处置线索"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "reviewedCases"}
                  onClick={() => setRecordKey("reviewedCases")}
                >
                  <span>已归档/处置</span>
                  <strong>{number(reviewedCases)}</strong>
                </button>
                <button
                  title="查看待审计划明细"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "pendingPlans"}
                  onClick={() => setRecordKey("pendingPlans")}
                >
                  <span>待审计划</span>
                  <strong>
                    {number(
                      data.scopedPlans?.filter(
                        (item) => item.status === "PENDING_REVIEW",
                      ).length,
                    )}
                  </strong>
                </button>
              </div>
              <div className="command-progress-caption">
                <span>线索处置率</span>
                <strong>
                  {resolvedPercent === null ? "—" : `${resolvedPercent}%`}
                </strong>
              </div>
              <div className="command-progress">
                <span style={{ width: `${resolvedPercent || 0}%` }} />
              </div>
            </Panel>
            <Panel
              title="计划与任务"
              action={<span className="command-mini-label">业务总览</span>}
              className="command-task-panel"
            >
              <div className="command-task-grid">
                <button
                  title="查看待执行/分配明细"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "pendingTasks"}
                  onClick={() => setRecordKey("pendingTasks")}
                >
                  <i />
                  <span>待执行/分配</span>
                  <strong>{number(pendingTasks)}</strong>
                </button>
                <button
                  title="查看执行中明细"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "executingTasks"}
                  onClick={() => setRecordKey("executingTasks")}
                >
                  <i />
                  <span>执行中</span>
                  <strong>{number(data.currentTasks?.length)}</strong>
                </button>
                <button
                  title="查看已完成明细"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "completedTasks"}
                  onClick={() => setRecordKey("completedTasks")}
                >
                  <i />
                  <span>已完成</span>
                  <strong>{number(completedTasks)}</strong>
                </button>
                <button
                  title="查看飞行计划明细"
                  aria-haspopup="dialog"
                  aria-expanded={recordKey === "plans"}
                  onClick={() => setRecordKey("plans")}
                >
                  <i />
                  <span>飞行计划</span>
                  <strong>{number(data.scopedPlans?.length)}</strong>
                </button>
              </div>
            </Panel>
            <Panel
              title="地图图层"
              action={<Layers3 size={13} />}
              className="command-layer-panel"
            >
              <div className="command-layers">
                {Object.entries(layerLabels).map(([key, label]) => (
                  <button
                    key={key}
                    aria-label={label}
                    aria-pressed={layers[key as keyof typeof layers]}
                    title={`${layers[key as keyof typeof layers] ? "隐藏" : "显示"}${label}`}
                    className={
                      layers[key as keyof typeof layers] ? "active" : ""
                    }
                    onClick={() => {
                      if (
                        selected &&
                        layerOf(selected) === key &&
                        layers[key as keyof typeof layers]
                      )
                        closeMapObject();
                      setLayers((current) => ({
                        ...current,
                        [key]: !current[key as keyof typeof layers],
                      }));
                    }}
                  >
                    <i />
                    {label}
                  </button>
                ))}
              </div>
              <p className="command-panel-footnote">
                <span className="command-fleet-dot" />
                航空器 · 高度航迹 · 地面投影
              </p>
            </Panel>
          </aside>
          <section
            className="map-metrics command-kpis"
            aria-label="飞行累计统计"
          >
            <button
              className="command-current"
              title="查看当前执行任务"
              aria-haspopup="dialog"
              aria-expanded={recordKey === "executingTasks"}
              onClick={() => setRecordKey("executingTasks")}
            >
              <i />
              <span>当前执行</span>
              <strong>{number(data.currentTasks?.length)}</strong>
              <span>项任务</span>
              <em>{region || "全市"}</em>
              <ChevronRight size={13} />
            </button>
            {kpis.map((item) => (
              <button
                className="command-kpi"
                key={item.label}
                title={`查看${item.label}的设备贡献明细`}
                aria-haspopup="dialog"
                aria-expanded={recordKey === item.recordKey}
                onClick={() => setRecordKey(item.recordKey)}
              >
                <div>
                  <item.icon size={18} />
                  <span>{item.label}</span>
                  <small>
                    来源累计 <ChevronRight size={11} />
                  </small>
                </div>
                <strong>
                  <span className="command-number-value" key={item.value}>
                    {item.value}
                  </span>
                  <small>{item.unit}</small>
                </strong>
                <span className="command-kpi-rule" />
              </button>
            ))}
          </section>
          <div className="command-center-note command-map-hint">
            <span />
            <small>
              {selected ? "Esc 关闭对象详情" : "拖动地图 · 点击对象查看详情"}
            </small>
            <span />
          </div>
          {selectedEntity && (
            <section
              className="command-map-inspector"
              role="region"
              aria-label="地图对象详情"
            >
              <div className="command-inspector-heading">
                <span className="command-object-kind">
                  <MapPin size={13} />
                  {objectKindLabel(selectedEntity)}
                </span>
                <button
                  className="command-inspector-close"
                  aria-label="关闭地图详情"
                  title="关闭对象详情（Esc）"
                  onClick={closeMapObject}
                >
                  <X size={16} />
                </button>
              </div>
              <h3>{entityName(selectedEntity)}</h3>
              <dl className="command-inspector-meta">
                <div>
                  <dt>所属区域</dt>
                  <dd>{selectedEntity.region || "未关联区域"}</dd>
                </div>
                <div>
                  <dt>当前状态</dt>
                  <dd>
                    <Status status={selectedStatus} />
                  </dd>
                </div>
                <div>
                  <dt>{selectedIsDevice ? "最近观测" : "最近更新"}</dt>
                  <dd>
                    {dateTime(
                      selectedEntity.lastObservedAt || selectedEntity.updatedAt,
                    )}
                  </dd>
                </div>
              </dl>
              <p className="command-location-note">
                {hasMapObjectLocation(selectedEntity)
                  ? ["AIRSPACE", "ROUTE"].includes(kindOf(selectedEntity))
                    ? "已选中范围，可在地图中查看完整边界"
                    : "已选中对象，可在地图中查看上报位置"
                  : "当前对象暂无有效位置，仍可查看档案"}
              </p>
              <div className="command-inspector-actions">
                <Button
                  small
                  disabled={!hasMapObjectLocation(selectedEntity)}
                  title={
                    hasMapObjectLocation(selectedEntity)
                      ? "重新定位选中对象"
                      : "暂无有效坐标或范围"
                  }
                  onClick={() =>
                    setFocusRequest({
                      entity: selectedEntity,
                      revision: ++focusRevision.current,
                    })
                  }
                >
                  <Crosshair size={13} />
                  定位
                </Button>
                <Button
                  small
                  primary
                  onClick={() =>
                    selectedIsDevice
                      ? navigate("flight", { deviceId: selectedEntity.id })
                      : setResourceDetail(true)
                  }
                >
                  {selectedIsDevice ? "设备遥测" : "查看档案"}
                  <ArrowRight size={13} />
                </Button>
              </div>
            </section>
          )}
          <aside className="command-right">
            <Panel
              title="重点关注"
              action={
                <button
                  className="command-text-link"
                  onClick={() => setRecordKey("openCases")}
                  title="查看全部未结线索"
                  aria-haspopup="dialog"
                >
                  全部
                  <ArrowRight size={12} />
                </button>
              }
              className="command-attention"
            >
              {data.openCases?.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  className="command-attention-item"
                  title={`查看${entityName(item)}`}
                  aria-haspopup="dialog"
                  onClick={() => setCaseDetail(item)}
                >
                  <span>
                    <ShieldAlert size={13} />
                    {item.region || "待核定区域"}
                    <Status status={item.status} />
                  </span>
                  <strong>{entityName(item)}</strong>
                </button>
              ))}
              {data.currentTasks?.slice(0, 1).map((item) => (
                <button
                  key={item.id}
                  className="command-attention-item command-task-attention"
                  title={`查看任务：${entityName(item)}`}
                  onClick={() => navigate("dispatch", { taskId: item.id })}
                >
                  <span>
                    <Activity size={13} />
                    执行任务
                    <Status status={item.status} />
                  </span>
                  <strong>{entityName(item)}</strong>
                </button>
              ))}
              {data.openCases &&
                data.currentTasks &&
                !data.openCases.length &&
                !data.currentTasks.length && (
                  <p className="command-empty">当前暂无待关注事项</p>
                )}
              {(!data.openCases || !data.currentTasks) && (
                <p className="command-empty">
                  {cases.isError || tasks.isError
                    ? "关注事项暂不可用"
                    : "正在同步关注事项…"}
                </p>
              )}
            </Panel>
            <Panel
              title="空域与重点保障"
              action={
                <span className="command-mini-label">
                  {number(data.airspaces?.length)} 个区域
                </span>
              }
              className="command-airspaces"
            >
              {data.airspaces?.slice(0, 2).map((item) => (
                <button
                  key={item.id}
                  className="command-airspace-item"
                  aria-pressed={selected?.id === item.id}
                  title={`在地图查看${entityName(item)}`}
                  onClick={() => selectMapObject(item)}
                >
                  <MapPin size={16} />
                  <div>
                    <strong>{entityName(item)}</strong>
                    <small>
                      {item.region || "区域待核定"} ·{" "}
                      <span>
                        {item.status ? (
                          <Status status={item.status} />
                        ) : (
                          "空域资源"
                        )}
                      </span>
                    </small>
                  </div>
                  <ChevronRight size={13} />
                </button>
              ))}
              {!data.airspaces?.length && (
                <p className="command-empty">
                  {resources.isError
                    ? "空域数据暂不可用"
                    : resources.isPending
                      ? "正在同步空域…"
                      : "当前区域暂无空域资源"}
                </p>
              )}
              <button
                className="command-panel-link"
                title="查看当前区域空域与航线"
                aria-haspopup="dialog"
                onClick={() => setRecordKey("resources")}
              >
                <span>查看全部资源</span>
                <span>
                  {number(data.routes?.length)} 条航线 <ArrowRight size={12} />
                </span>
              </button>
            </Panel>
            <Panel
              title="数据保障"
              action={
                <button
                  className="command-text-link"
                  title="查看数据同步状态"
                  aria-haspopup="dialog"
                  onClick={() => setFeedInfo(true)}
                >
                  自动同步 <ChevronRight size={11} />
                </button>
              }
              className="command-data-panel"
            >
              {feedStates.map((feed) => (
                <button
                  key={feed.label}
                  className="command-feed"
                  title={`查看${feed.label}同步状态`}
                  aria-haspopup="dialog"
                  onClick={() => setFeedInfo(true)}
                >
                  <i
                    className={
                      feed.error || feed.query.isError
                        ? "error"
                        : feed.query.data &&
                            (feed.label !== "任务与线索" ||
                              (cases.data && plans.data))
                          ? "ready"
                          : "waiting"
                    }
                  />
                  <span>{feed.label}</span>
                  <small>
                    {feed.error || feed.query.isError
                      ? "连接异常"
                      : feed.detail}
                  </small>
                  <ChevronRight size={11} />
                </button>
              ))}
              <p className="command-panel-footnote">
                区域气象未接入 · 可从设备档案核对机巢观测
              </p>
            </Panel>
          </aside>
          <div className="command-bottom-charts">
            <Panel
              title="任务时段分布"
              action={
                <span className="command-chart-heading-meta">
                  <span className="command-mini-label">
                    今日 · 计划开始时间
                  </span>
                  <span className="command-chart-hint">
                    点击时段查看任务 <ChevronRight size={11} />
                  </span>
                </span>
              }
            >
              <HourlyChart
                values={data.hours}
                activeHour={
                  taskDrilldown?.kind === "hour"
                    ? taskDrilldown.hour
                    : undefined
                }
                onSelect={(hour) => setTaskDrilldown({ kind: "hour", hour })}
              />
            </Panel>
            <Panel
              title="区域任务分布"
              action={
                <span className="command-chart-heading-meta">
                  <span className="command-mini-label">
                    今日 · {number(data.todayTasks?.length)} 项任务
                  </span>
                  <span className="command-chart-hint">
                    点击区域查看任务 <ChevronRight size={11} />
                  </span>
                </span>
              }
            >
              <RegionalChart
                items={data.regions}
                activeRegion={
                  taskDrilldown?.kind === "region"
                    ? taskDrilldown.region
                    : undefined
                }
                onSelect={(selectedRegion) =>
                  setTaskDrilldown({ kind: "region", region: selectedRegion })
                }
              />
            </Panel>
          </div>
        </div>
        {refreshResult && !feedInfo && (
          <div className="command-refresh-feedback" role="status">
            {refreshResult}
          </div>
        )}
        <footer className="command-footer">
          <time>
            {dateTime(now.toISOString())}
            <span>{String(now.getSeconds()).padStart(2, "0")}</span>
          </time>
          <span>{data.objects.length} 个业务对象 · 全域运行态势</span>
          <span>
            <i />
            {Number.isFinite(latestRead)
              ? `最近同步 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(latestRead))}`
              : "等待数据同步"}
          </span>
        </footer>
      </div>
      {recordGroup && (
        <CommandRecordList
          group={recordGroup}
          region={region}
          loading={recordGroup.items === undefined && !recordError}
          error={recordError}
          caption={recordCaption}
          status={recordStatus}
          onSelect={chooseRecord}
          onClose={() => setRecordKey(null)}
          onNavigate={() => navigate(recordGroup.destination)}
        />
      )}
      {caseDetail && (
        <Modal
          title={entityName(caseDetail)}
          className="command-task-dialog"
          onClose={() => setCaseDetail(null)}
        >
          <Details
            items={[
              { label: "所属区域", value: caseDetail.region || "未关联区域" },
              {
                label: "应用场景",
                value: String(caseDetail.scene || "未设置"),
              },
              {
                label: "当前状态",
                value: <Status status={caseDetail.status} />,
              },
              {
                label: "线索描述",
                value: String(caseDetail.description || "暂无描述"),
              },
              {
                label: "处置结论",
                value: String(caseDetail.conclusion || "尚未登记"),
              },
              { label: "最后更新", value: dateTime(caseDetail.updatedAt) },
            ]}
          />
          <div className="command-record-footer">
            {caseDetail.taskId ? (
              <Button
                small
                onClick={() =>
                  navigate("dispatch", { taskId: String(caseDetail.taskId) })
                }
              >
                查看关联任务
                <ArrowRight size={13} />
              </Button>
            ) : (
              <span />
            )}
            <Button small primary onClick={() => navigate("scenes")}>
              前往场景应用
              <ArrowRight size={13} />
            </Button>
          </div>
        </Modal>
      )}
      {feedInfo && (
        <Modal
          title="数据同步状态"
          className="command-task-dialog command-feed-dialog"
          onClose={() => setFeedInfo(false)}
        >
          <p className="command-feed-summary">
            来源设备每 5 秒、业务目录每 30
            秒自动同步当前授权数据，可手动刷新重试。
          </p>
          {[
            { label: "来源设备", query: devices },
            { label: "资源与空域", query: resources },
            { label: "任务目录", query: tasks },
            { label: "线索目录", query: cases },
            { label: "飞行计划", query: plans },
          ].map((feed) => (
            <div className="command-feed-row" key={feed.label}>
              <div>
                <strong>{feed.label}</strong>
                <small>
                  {feed.query.dataUpdatedAt
                    ? `最近同步 ${dateTime(new Date(feed.query.dataUpdatedAt).toISOString())}`
                    : "尚未完成同步"}
                </small>
              </div>
              <Status
                status={
                  feed.query.isError
                    ? "ERROR"
                    : feed.query.isFetching
                      ? "UNKNOWN"
                      : feed.query.data
                        ? "CONNECTED"
                        : "UNKNOWN"
                }
                label={
                  feed.query.isError
                    ? "同步失败"
                    : feed.query.isFetching
                      ? "同步中"
                      : feed.query.data
                        ? "已同步"
                        : "等待同步"
                }
              />
            </div>
          ))}
          <div className="command-record-footer">
            <span role={refreshResult ? "status" : undefined}>
              {refreshResult || "区域气象尚未接入"}
            </span>
            <Button small primary onClick={refreshBoard} disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? "spinning" : ""} />
              {refreshing ? "同步中…" : "立即刷新"}
            </Button>
          </div>
        </Modal>
      )}
      {taskDrilldown && (
        <Modal
          title={
            taskDrilldown.kind === "hour" ? "任务时段明细" : "区域任务明细"
          }
          className="command-task-dialog"
          wide
          onClose={() => setTaskDrilldown(null)}
        >
          <div className="command-drilldown-summary">
            <div>
              <span>{day} · 北京时间</span>
              <strong>{drilldownScope}</strong>
            </div>
            <span className="command-drilldown-total">
              <strong>{number(drilldownTasks?.length)}</strong> 项任务
            </span>
          </div>
          {drilldownTasks?.length ? (
            <ul className="command-drilldown-list" aria-label="对应任务">
              {drilldownTasks.map((task) => (
                <li key={task.id}>
                  <button
                    onClick={() => navigate("dispatch", { taskId: task.id })}
                  >
                    <span className="command-drilldown-time">
                      <Clock3 size={14} />
                      {dateTime(task.startAt, true)}
                    </span>
                    <span className="command-drilldown-task">
                      <strong>{entityName(task)}</strong>
                      <small>
                        {task.region || "未分区"}
                        {task.scene ? ` · ${String(task.scene)}` : ""}
                      </small>
                    </span>
                    <Status status={task.status} />
                    <ChevronRight size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="command-drilldown-empty" role="status">
              <Clock3 size={28} />
              <strong>
                {drilldownTasks ? "当前范围暂无任务" : "任务数据暂不可用"}
              </strong>
              <span>
                {drilldownTasks
                  ? "可返回图表查看其他时段或区域"
                  : "请等待数据同步后重试"}
              </span>
            </div>
          )}
          <p className="command-drilldown-note">
            按计划开始时间统计，已排除取消任务。点击任务查看详情。
          </p>
        </Modal>
      )}
      {info && (
        <Modal title="指挥大屏统计口径" onClose={() => setInfo(false)}>
          <p>
            设备、空域、任务、计划与线索按当前账号的授权范围和所选区域统计。业务目录会读取所有分页，避免只统计首屏记录。
          </p>
          <p>
            累计架次、时长和里程来自来源设备上报，当前有{" "}
            {data.totals.devicesWithStatistics}{" "}
            台设备提供累计统计；未提供的指标保持未知。没有明确区域关联的来源设备只计入“全市”。
          </p>
          <p>
            底部图表按任务的计划开始时间统计今日任务，采用北京时间，排除已取消任务；不代表实际起飞架次。
          </p>
        </Modal>
      )}
      {resourceDetail && selectedEntity && (
        <Modal
          title={entityName(selectedEntity)}
          className="command-task-dialog"
          onClose={() => setResourceDetail(false)}
        >
          <Details
            items={[
              { label: "对象编号", value: selectedEntity.id },
              { label: "对象类型", value: objectKindLabel(selectedEntity) },
              {
                label: "所属区域",
                value: selectedEntity.region || "未关联区域",
              },
              { label: "对象状态", value: <Status status={selectedStatus} /> },
              {
                label: "最后更新",
                value: dateTime(
                  selectedEntity.lastObservedAt || selectedEntity.updatedAt,
                ),
              },
            ]}
          />
          <Button
            primary
            onClick={() =>
              navigate(
                selectedIsDevice ? "flight" : "resources",
                selectedIsDevice ? { deviceId: selectedEntity.id } : {},
              )
            }
          >
            {selectedIsDevice ? "查看设备遥测" : "前往资源管理"}
            <ArrowRight size={13} />
          </Button>
        </Modal>
      )}
    </div>
  );
}
