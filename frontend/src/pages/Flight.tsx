import type { Navigate } from "../navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BatteryMedium,
  Compass,
  FileText,
  Radio,
  Search,
  Video,
  Wifi,
} from "lucide-react";
import {
  entityName,
  useCatalog,
  useData,
  useDevices,
  useList,
  type Entity,
} from "../api";
import { useFeedback, useUser } from "../context";
import { getFlightControlGate } from "../flightControls";
import FlightOperationControls from "../components/FlightOperationControls";
import { dateTime } from "../domain";
import FlightMap from "../components/FlightMap";
import DeviceFlightHistory, {
  DeviceFlightSummary,
} from "../components/DeviceFlightHistory";
import { getFlightTotals } from "../flightStatistics";
import {
  deviceObservationStatus,
  onlineDevicesFirst,
  resolveFlightDevice,
} from "../flightDeviceOrder";
import { secondsLabel } from "../domain";
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
export default function Flight({
  navigate,
  deviceId,
  taskId,
}: {
  navigate: Navigate;
  deviceId?: string;
  taskId?: string;
}) {
  const user = useUser();
  const feedback = useFeedback();
  const [gimbalYaw, setGimbalYaw] = useState(0);
  const [gimbalPitch, setGimbalPitch] = useState(0);
  const [search, setSearch] = useState("");
  const [deviceType, setDeviceType] = useState("");
  const [selection, setSelection] = useState<{
    key: string;
    id: string;
  } | null>(null);
  const [record, setRecord] = useState(false);
  const devices = useDevices();
  const local = useCatalog("/resources", { kind: "DEVICE" });
  const tasks = useCatalog("/tasks");
  const observationNow = Date.now();
  const rows = onlineDevicesFirst(
    (devices.data?.items || []).filter(
      (r) =>
        (!deviceType ||
          (deviceType === "recorded"
            ? !!getFlightTotals(r)
            : r.type === deviceType)) &&
        (!search ||
          [entityName(r), r.sn, r.id].some((value) =>
            String(value ?? "")
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
          )),
    ),
    observationNow,
  );
  const taskContext = useData<Entity>(
    `/tasks/${taskId || "none"}`,
    !!taskId,
    5000,
  );
  const operationResource = local.data?.items.find(
    (resource) => resource.id === taskContext.data?.deviceId,
  );
  const selectionKey = JSON.stringify([deviceId, taskId, deviceType, search]);
  const current = resolveFlightDevice(devices.data?.items || [], rows, {
    deviceId,
    taskId,
    taskSourceDeviceId:
      typeof operationResource?.sourceDeviceId === "string"
        ? operationResource.sourceDeviceId
        : undefined,
    selectedId: selection?.key === selectionKey ? selection.id : undefined,
  });
  useEffect(() => {
    if (
      !deviceId &&
      !taskId &&
      current &&
      (selection?.key !== selectionKey || selection.id !== current.id)
    )
      setSelection({ key: selectionKey, id: current.id });
  }, [current, deviceId, taskId, selection, selectionKey]);
  const returnToTask = () =>
    navigate("dispatch", taskId ? { taskId } : undefined);
  const selectDevice = (device: Entity) =>
    navigate("flight", {
      deviceId: device.id,
      taskId:
        device.id === (deviceId || operationResource?.sourceDeviceId)
          ? taskId
          : undefined,
    });
  const telemetry = useData<Entity>(
    `/devices/${current?.id || "none"}/telemetry`,
    !!current,
    5000,
  );
  const details = telemetry.data || ({} as Entity);
  const observationError = telemetry.error || devices.error;
  const currentStatus = observationError
    ? "UNKNOWN"
    : deviceObservationStatus(
        {
          id: current?.id || "none",
          status: String(details.status || current?.status || "UNKNOWN"),
          lastObservedAt: details.lastObservedAt || current?.lastObservedAt,
        },
        observationNow,
      );
  const t = (details.data || details.telemetry || details) as Record<
    string,
    unknown
  >;
  const related =
    tasks.data?.items.filter(
      (task) =>
        local.data?.items.find((r) => r.id === task.deviceId)
          ?.sourceDeviceId === current?.id,
    ) || [];
  const approval = useData<Entity>(
    `/plans/${taskContext.data?.planId || "none"}`,
    !!taskContext.data?.planId,
    5000,
  );
  const operationContext = {
    user,
    device: current,
    resource: operationResource,
    task: taskContext.data,
    plan: approval.data,
    loading:
      devices.isLoading ||
      local.isLoading ||
      (!!taskId && taskContext.isLoading) ||
      (!!taskContext.data?.planId && approval.isLoading),
    error: devices.error || local.error || taskContext.error || approval.error,
  };
  const operationGate = getFlightControlGate(operationContext);
  useEffect(() => {
    setGimbalYaw(0);
    setGimbalPitch(0);
  }, [current?.id, taskId, approval.data?.status]);
  const objects = useMemo(() => devices.data?.items || [], [devices.data]);
  return (
    <div className="page">
      <PageHeader
        title="飞行管控"
        subtitle="关联计划审批通过后解锁设备操作；当前点击仅在页面响应"
      >
        <Button onClick={returnToTask}>
          <ArrowLeft size={13} />
          {taskId ? "返回当前任务" : "返回任务列表"}
        </Button>
        <span className="label-tag">仅页面交互</span>
      </PageHeader>
      {taskId && (
        <div className="flight-task-context" role="note">
          <div>
            <small>从任务进入</small>
            <strong>
              {taskContext.data
                ? entityName(taskContext.data)
                : taskContext.error
                  ? "关联任务暂不可查看"
                  : "正在加载关联任务"}
            </strong>
            <span>查看该任务分配的设备，成果与验收返回任务单办理。</span>
          </div>
          <Button small onClick={returnToTask}>
            返回当前任务 <ArrowRight size={12} />
          </Button>
        </div>
      )}
      {deviceId && devices.data && !current && (
        <p className="form-error">
          关联设备不存在或不在当前账号可见范围内，请返回任务核对设备分配。
        </p>
      )}
      <div className="flight-layout">
        <aside className="queue">
          <div
            className="queue-label"
            title="最近有效观测的在线设备优先，离线与未知设备随后展示"
          >
            <Radio size={14} />
            设备清单 · 在线优先<span>{devices.data?.total ?? "—"}</span>
          </div>
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="搜索设备或序列号"
          />
          <Select
            label="管控设备类型"
            value={deviceType}
            onChange={(value) => {
              setDeviceType(value);
              setSelection(null);
            }}
            options={[
              { value: "", label: "全部设备" },
              { value: "recorded", label: "有飞行统计的设备" },
              { value: "UAV", label: "飞机" },
              { value: "UAV_AIRPORT", label: "机巢" },
            ]}
          />
          {rows.map((r) => (
            <button
              className={`queue-card ${r.id === current?.id ? "selected" : ""}`}
              key={r.id}
              onClick={() => selectDevice(r)}
            >
              <strong>{entityName(r)}</strong>
              <small>{String(r.sn || r.id)}</small>
              {getFlightTotals(r) && (
                <small>
                  {getFlightTotals(r)?.sorties ?? "未知"} 架次 ·{" "}
                  {secondsLabel(getFlightTotals(r)?.timeSeconds)}
                </small>
              )}
              <Status status={deviceObservationStatus(r, observationNow)} />
            </button>
          ))}
          {!rows.length && (
            <Empty
              loading={devices.isLoading}
              error={devices.error}
              title="暂无可见设备"
              description="接入来源设备后，可以查看实时观测。"
            />
          )}
        </aside>
        <div className="flight-center">
          <div className="flight-main-map">
            <FlightMap
              compact
              objects={objects}
              focusObject={current}
              onSelect={selectDevice}
            />
            <div className="telemetry-strip">
              {[
                {
                  label: "高度",
                  icon: Compass,
                  value: t.altitudeMeters ?? t.height ?? t.altitude,
                  unit: "m",
                },
                {
                  label: "设备电量",
                  icon: BatteryMedium,
                  value: t.batteryPercent ?? t.battery ?? t.electricity,
                  unit: "%",
                },
                {
                  label: "地速",
                  icon: Radio,
                  value: t.speed ?? t.horizontalSpeed,
                  unit: "m/s",
                },
              ].map((m) => (
                <div key={m.label}>
                  <m.icon size={16} />
                  <span>{m.label}</span>
                  <strong>
                    {m.value === undefined || m.value === null
                      ? "—"
                      : String(m.value)}
                    <small>{m.unit}</small>
                  </strong>
                </div>
              ))}
              <div>
                <Wifi size={15} />
                <span>链路状态</span>
                <Status status={currentStatus} />
              </div>
            </div>
          </div>
          <section className="video-panel">
            <div className="section-title">
              <h3>
                <Video size={14} />
                任务画面
              </h3>
              <span>可见光 / 红外</span>
            </div>
            <Unavailable
              title="实时视频来源未接通"
              description="真实画面可用后启用预览与截图，不使用示例图片替代现场画面。"
            />
            <div className="video-empty">
              <Video size={42} />
              <small>等待真实媒体来源</small>
            </div>
          </section>
        </div>
        <aside className="flight-control">
          <small>当前查看对象</small>
          <h2>{current ? entityName(current) : "选择设备"}</h2>
          {current && <Status status={currentStatus} />}
          {observationError && (
            <p className="form-error">
              当前观测不可用：{observationError.message}
            </p>
          )}
          {current && <DeviceFlightSummary device={current} />}
          <section className="section control-task-selector">
            <h3>关联作业与审批</h3>
            <Select
              label="关联作业任务"
              value={taskId || ""}
              onChange={(id) => {
                if (current)
                  navigate("flight", {
                    deviceId: current.id,
                    taskId: id || undefined,
                  });
              }}
              options={[
                { value: "", label: "选择本设备的关联任务" },
                ...related.map((task) => ({
                  value: task.id,
                  label: entityName(task),
                })),
                ...(taskId && !related.some((task) => task.id === taskId)
                  ? [
                      {
                        value: taskId,
                        label: taskContext.data
                          ? entityName(taskContext.data)
                          : "正在加载关联任务",
                      },
                    ]
                  : []),
              ]}
            />
            {!!taskContext.data?.planId && (
              <Button
                small
                onClick={() =>
                  navigate("services", {
                    planId: String(taskContext.data!.planId),
                    taskId: taskContext.data!.id,
                  })
                }
              >
                查看 / 办理审批 <ArrowRight size={12} />
              </Button>
            )}
            {taskContext.data && !taskContext.data.planId && (
              <Button small onClick={returnToTask}>
                返回任务关联计划 <ArrowRight size={12} />
              </Button>
            )}
          </section>
          <FlightOperationControls {...operationContext} />
          <section className="section payload-controls">
            <h3>载荷控制</h3>
            <label className="range-label">
              云台目标方位角 · {gimbalYaw}°
              <input
                type="range"
                min={-180}
                max={180}
                value={gimbalYaw}
                disabled={!operationGate.enabled}
                onChange={(event) => setGimbalYaw(Number(event.target.value))}
              />
            </label>
            <label className="range-label">
              云台目标俯仰角 · {gimbalPitch}°
              <input
                type="range"
                min={-90}
                max={30}
                value={gimbalPitch}
                disabled={!operationGate.enabled}
                onChange={(event) => setGimbalPitch(Number(event.target.value))}
              />
            </label>
            <Button
              disabled={!operationGate.enabled}
              title={
                operationGate.enabled
                  ? "仅页面交互，不发送设备指令"
                  : operationGate.reason
              }
              onClick={() => {
                if (operationGate.enabled)
                  feedback("已点击发送云台指令，未发送设备指令。");
              }}
            >
              发送云台指令
            </Button>
            <Button
              disabled={!operationGate.enabled}
              title={
                operationGate.enabled
                  ? "仅页面交互，不发送设备指令"
                  : operationGate.reason
              }
              onClick={() => {
                if (operationGate.enabled)
                  feedback("已点击发送喊话，未发送设备指令。");
              }}
            >
              发送喊话
            </Button>
          </section>
          <section className="section">
            <h3>关联本地任务</h3>
            {related.map((r) => (
              <button
                className="attention-item"
                key={r.id}
                onClick={() => navigate("dispatch", { taskId: r.id })}
              >
                <strong>{entityName(r)}</strong>
                <Status status={r.status} />
              </button>
            ))}
            {!related.length && <p className="muted">暂无已关联任务</p>}
          </section>
          <Button onClick={() => setRecord(true)}>
            <FileText size={14} />
            查看观测与飞行记录 <ArrowRight size={12} />
          </Button>
          <small className="footnote">
            末次观测 {dateTime(current?.lastObservedAt)}
          </small>
        </aside>
      </div>
      {record && (
        <Modal title="设备观测与飞行记录" onClose={() => setRecord(false)} wide>
          {current ? (
            <>
              <Details
                items={[
                  { label: "设备名称", value: entityName(current) },
                  { label: "来源 ID", value: current.id },
                  {
                    label: "经度",
                    value: String(t.longitude ?? current.longitude ?? "未知"),
                  },
                  {
                    label: "纬度",
                    value: String(t.latitude ?? current.latitude ?? "未知"),
                  },
                  {
                    label: "源观测时间",
                    value: dateTime(
                      details.lastObservedAt || current.lastObservedAt,
                    ),
                  },
                  {
                    label: "末次坐标观测",
                    value: dateTime(details.positionObservedAt),
                  },
                  { label: "接收时间", value: dateTime(details.receivedAt) },
                  {
                    label: "机巢风速",
                    value:
                      t.windSpeed === null || t.windSpeed === undefined
                        ? "未知"
                        : `${t.windSpeed} m/s`,
                  },
                  {
                    label: "温度",
                    value:
                      t.temperature === null || t.temperature === undefined
                        ? "未知"
                        : `${t.temperature} °C`,
                  },
                ]}
              />
              <DeviceFlightHistory device={current} />
              <Unavailable
                title="物理起降与完整历史轨迹待验证"
                description="任务完成状态不会自动当作已落地。来源飞行统计可在资源管理的飞行记录中查看。"
              />
              <Button
                onClick={() => {
                  setRecord(false);
                  navigate("resources");
                }}
              >
                进入飞行记录
              </Button>
            </>
          ) : (
            <Empty title="请先选择设备" />
          )}
        </Modal>
      )}
    </div>
  );
}
