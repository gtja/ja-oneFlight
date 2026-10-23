import { useMemo, useState } from "react";
import {
  ArrowRight,
  Cloud,
  FileText,
  Info,
  Layers3,
  ShieldAlert,
} from "lucide-react";
import {
  entityName,
  useCatalog,
  useData,
  useDevices,
  useList,
  type Entity,
} from "../api";
import { dateTime, REGIONS, secondsLabel } from "../domain";
import type { Navigate } from "../navigation";
import DeviceDetails from "../components/DeviceDetails";
import { summarizeFlightTotals } from "../flightStatistics";
import FlightMap, { type AreaFocusRequest } from "../components/FlightMap";
import { mapObjectsLocation } from "../components/mapObjectFocus";
import "./Overview.css";
import "./experience.css";
import {
  Button,
  Details,
  Empty,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Status,
  Unavailable,
} from "../components/UI";
export default function Overview({ navigate }: { navigate: Navigate }) {
  const [region, setRegion] = useState("");
  const [period, setPeriod] = useState("today");
  const [search, setSearch] = useState("");
  const [layers, setLayers] = useState({
    airspace: true,
    sites: true,
    devices: true,
    detectors: true,
    equipment: true,
  });
  const [areaFocus, setAreaFocus] = useState<AreaFocusRequest>();
  const [areaMessage, setAreaMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [info, setInfo] = useState(false);
  const dashboard = useData<Entity>("/dashboard", true, 30_000);
  const devices = useDevices();
  const local = useCatalog("/resources", {}, true, 30_000);
  const cases = useList("/cases");
  const tasks = useList("/tasks");
  const catalogObjects = useMemo<Entity[]>(
    () => [
      ...(devices.data?.items || []).map((device) => ({
        ...device,
        sourceDeviceId: device.id,
        region: (local.data?.items || []).find(
          (resource) => resource.sourceDeviceId === device.id,
        )?.region,
      })),
      ...(local.data?.items || []).filter(
        (r) =>
          !r.sourceDeviceId &&
          ["DEVICE", "ROUTE", "AIRSPACE"].includes(String(r.kind)),
      ),
    ],
    [devices.data, local.data],
  );
  const objects = useMemo(
    () =>
      catalogObjects.filter(
        (r) =>
          (!region || r.region === region) &&
          (!search || entityName(r).includes(search)),
      ),
    [catalogObjects, region, search],
  );
  const selected =
    catalogObjects.find(
      (item) => item.id === selectedId && (!region || item.region === region),
    ) || null;
  function focusRegion(nextRegion: string) {
    const location = nextRegion
      ? mapObjectsLocation(
          catalogObjects.filter((item) => item.region === nextRegion),
        )
      : null;
    setAreaMessage(
      nextRegion && !location ? "该区域暂无可定位对象，已恢复杭州视角" : "",
    );
    setAreaFocus((previous) => ({
      location,
      revision: (previous?.revision || 0) + 1,
    }));
  }
  const currentTasks =
    tasks.data?.items.filter((r) => r.status === "EXECUTING") || [];
  const openCases =
    cases.data?.items.filter((r) => r.status !== "ARCHIVED") || [];
  const visibleDevices = (devices.data?.items || []).filter(
    (device) => !region || objects.some((object) => object.id === device.id),
  );
  const totals = summarizeFlightTotals(visibleDevices);
  const selectedDevice =
    typeof selected?.sourceDeviceId === "string"
      ? devices.data?.items.find(
          (device) => device.id === selected.sourceDeviceId,
        )
      : undefined;
  const resourceType =
    selected?.kind === "ROUTE"
      ? "航线"
      : selected?.kind === "AIRSPACE"
        ? "空域"
        : "设备档案";
  const metrics = [
    {
      label: "当前执行任务",
      number: dashboard.data?.executingTasks ?? "—",
      unit: "项",
      view: "dispatch",
    },
    {
      label: "来源设备",
      number: devices.data ? visibleDevices.length : "—",
      unit: "台",
      view: "resources",
    },
    {
      label: "当前未结线索",
      number: dashboard.data?.openCases ?? "—",
      unit: "条",
      view: "scenes",
    },
    {
      label: "本地资源",
      number: dashboard.data?.resourcesCount ?? "—",
      unit: "项",
      view: "resources",
    },
    {
      label: "累计飞行架次",
      number: totals.sorties ?? "未知",
      unit: "架次",
      view: "resources",
    },
    {
      label: "累计飞行时长",
      number:
        totals.timeSeconds === null ? "未知" : secondsLabel(totals.timeSeconds),
      unit: "",
      view: "resources",
    },
  ];
  function exportReport() {
    const values = metrics
      .map((m) => `${m.label},${m.number},${m.unit}`)
      .join("\n");
    const blob = new Blob(["\uFEFF指标,数量,单位\n" + values], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `一网统飞运行报告-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="page overview-page experience-page">
      <PageHeader title="态势感知" subtitle="全域运行 · 对象核查与协同处置">
        <Select
          label="指挥区域"
          value={region}
          onChange={(nextRegion) => {
            setRegion(nextRegion);
            setSelectedId(null);
            focusRegion(nextRegion);
          }}
          options={[
            { value: "", label: "全部授权范围" },
            ...REGIONS.map((v) => ({ value: v, label: v })),
          ]}
        />
        <small>分析周期</small>
        <Select
          label="分析周期"
          value={period}
          onChange={setPeriod}
          options={[{ value: "today", label: "今日" }]}
        />
        <Button onClick={() => setReport(true)}>
          <FileText size={14} />
          运行报告
        </Button>
        <Button aria-label="指标口径与数据来源" onClick={() => setInfo(true)}>
          <Info size={14} />
        </Button>
      </PageHeader>
      <div className="overview-map">
        <FlightMap
          objects={objects}
          onSelect={(item) => setSelectedId(item.id)}
          layers={layers}
          areaFocusRequest={areaFocus}
          onResetView={() => focusRegion(region)}
        />
        {areaMessage && (
          <div className="overview-area-message" role="status">
            {areaMessage}
          </div>
        )}
        <div className="map-metrics">
          {metrics.map((m) => (
            <button key={m.label} onClick={() => navigate(m.view)}>
              <span>{m.label}</span>
              <strong>
                {String(m.number)}
                <small>{m.unit}</small>
              </strong>
            </button>
          ))}
        </div>
        <div className="map-search">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="搜索航空器、资源或空域"
          />
        </div>
        <aside className="map-sidebar">
          <section className="map-panel">
            <div className="section-title">
              <h3>重点关注</h3>
              <button className="text-link" onClick={() => navigate("scenes")}>
                全部 <ArrowRight size={12} />
              </button>
            </div>
            <div className="attention-counts">
              <button onClick={() => navigate("dispatch")}>
                执行任务<strong>{currentTasks.length}</strong>
              </button>
              <button onClick={() => navigate("scenes")}>
                未结线索<strong>{openCases.length}</strong>
              </button>
            </div>
            {openCases.slice(0, 4).map((c) => (
              <button
                className="attention-item"
                key={c.id}
                onClick={() => navigate("scenes")}
              >
                <small>
                  <ShieldAlert size={12} />
                  线索 · {c.region}
                </small>
                <strong>{entityName(c)}</strong>
                <Status status={c.status} />
              </button>
            ))}
            {currentTasks.slice(0, 3).map((t) => (
              <button
                className="attention-item"
                key={t.id}
                onClick={() => navigate("flight", { taskId: t.id })}
              >
                <strong>{entityName(t)}</strong>
                <small>{dateTime(t.startAt, true)}</small>
                <Status status={t.status} />
              </button>
            ))}
            {!openCases.length && !currentTasks.length && (
              <Empty
                title="暂无待关注事项"
                description="执行任务与待复核线索将在这里显示。"
              />
            )}
          </section>
          <section className="map-panel environment">
            <div className="section-title">
              <h3>环境保障</h3>
              <Cloud size={13} />
            </div>
            <p className="muted">区域气象服务未接入</p>
            <small>机巢观测可从对应设备档案核对。</small>
          </section>
          {devices.error && (
            <section className="map-panel source-warning">
              <strong>设备数据暂不可用</strong>
              <p>{devices.error.message}</p>
            </section>
          )}
        </aside>
        <div className="map-legend">
          <div>
            {Object.entries({
              airspace: "空域与航线",
              sites: "起降点",
              devices: "航空器",
              detectors: "探测设备",
              equipment: "其他设备",
            }).map(([key, label]) => (
              <button
                className={layers[key as keyof typeof layers] ? "active" : ""}
                key={key}
                onClick={() =>
                  setLayers({
                    ...layers,
                    [key]: !layers[key as keyof typeof layers],
                  })
                }
              >
                <Layers3 size={12} />
                {label}
              </button>
            ))}
          </div>
          <small>
            {objects.length} 个可见对象 ·{" "}
            {new Intl.DateTimeFormat("zh-CN", {
              timeZone: "Asia/Shanghai",
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date())}
          </small>
        </div>
      </div>
      {selected && (
        <Modal title={entityName(selected)} onClose={() => setSelectedId(null)}>
          {selectedDevice ? (
            <>
              <DeviceDetails device={selectedDevice} />
              <Button
                primary
                onClick={() => {
                  setSelectedId(null);
                  navigate("flight", { deviceId: selectedDevice.id });
                }}
              >
                查看设备遥测 <ArrowRight size={13} />
              </Button>
            </>
          ) : (
            <Details
              items={[
                { label: "资源类型", value: resourceType },
                { label: `${resourceType}编号`, value: selected.id },
                { label: "所属区域", value: selected.region || "—" },
                {
                  label: "当前状态",
                  value: <Status status={selected.status} />,
                },
                { label: "创建时间", value: dateTime(selected.createdAt) },
                { label: "更新时间", value: dateTime(selected.updatedAt) },
              ]}
            />
          )}
        </Modal>
      )}
      {report && (
        <Modal title="运行报告" onClose={() => setReport(false)}>
          <p className="muted">
            当前系统业务汇总 · {dateTime(new Date().toISOString())}
          </p>
          <Details
            items={metrics.map((m) => ({
              label: m.label,
              value: `${m.number} ${m.unit}`,
            }))}
          />
          <Button primary onClick={exportReport}>
            导出 CSV 报告
          </Button>
        </Modal>
      )}
      {info && (
        <Modal title="指标口径与数据来源" onClose={() => setInfo(false)}>
          <p>
            任务和线索指标来自本系统业务库，设备来自来源授权范围内的真实档案。飞行累计统计以来源上报的秒和米为基础。
          </p>
          <p>
            累计飞行指标来自已上报统计的 {totals.devicesWithStatistics}{" "}
            台设备，不以历史记录留存条数替代累计架次；未上报设备不补零。
          </p>
          <Unavailable
            title="未知来源保持未知"
            description="暂无可靠起降时刻、完整轨迹或区域气象来源时，页面不会补零或生成模拟数据。"
          />
        </Modal>
      )}
    </div>
  );
}
