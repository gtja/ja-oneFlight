import { useEffect, useState } from "react";
import { useFeedback } from "../context";
import { dateTime } from "../domain";
import {
  getFlightControlGate,
  type FlightControlContext,
} from "../flightControls";
import { Button, Status } from "./UI";

export type FlightOperationControlsProps = FlightControlContext;

const operations = [
  { id: "DISPATCH", label: "下发任务" },
  { id: "TAKEOFF", label: "立即起飞" },
  { id: "PAUSE", label: "暂停作业" },
  { id: "RETURN", label: "立即返航" },
  { id: "LAND", label: "确认落地并结束" },
] as const;

export default function FlightOperationControls(
  props: FlightOperationControlsProps,
) {
  const feedback = useFeedback();
  const gate = getFlightControlGate(props);
  const contextKey = JSON.stringify([
    props.user.id,
    props.user.role,
    props.device?.id,
    props.resource?.id,
    props.task?.id,
    props.task?.status,
    props.plan?.id,
    props.plan?.status,
    gate.enabled,
  ]);
  const [lastClick, setLastClick] = useState<{
    contextKey: string;
    id: string;
    label: string;
    at: string;
  } | null>(null);
  useEffect(() => setLastClick(null), [contextKey]);
  const recent =
    gate.enabled && lastClick?.contextKey === contextKey ? lastClick : null;

  return (
    <section
      className="section flight-operation-controls"
      data-testid="flight-operation-controls"
      data-control-enabled={String(gate.enabled)}
      data-gate-code={gate.code}
      data-local-state={recent?.id || "IDLE"}
      aria-label="作业控制"
    >
      <div className="operation-heading">
        <h3>作业控制</h3>
        <Status
          status={gate.enabled ? "APPROVED" : "PENDING_REVIEW"}
          label={gate.enabled ? "审批通过 · 已解锁" : "作业按钮未解锁"}
        />
      </div>
      {props.plan && (
        <div className="operation-plan">
          <small>关联飞行计划</small>
          <strong>
            {String(props.plan.title || props.plan.name || props.plan.id)}
          </strong>
          <Status status={props.plan.status} />
        </div>
      )}
      <p className="muted operation-gate-reason" role="status">
        {gate.reason}
      </p>
      <div className="operation-buttons">
        {operations.map((operation) => (
          <Button
            key={operation.id}
            primary={operation.id === "TAKEOFF" && gate.enabled}
            disabled={!gate.enabled}
            title={gate.enabled ? "仅页面交互，不发送设备指令" : gate.reason}
            onClick={() => {
              if (!getFlightControlGate(props).enabled) return;
              setLastClick({
                contextKey,
                id: operation.id,
                label: operation.label,
                at: new Date().toISOString(),
              });
              feedback(`已点击“${operation.label}”，未发送设备指令。`);
            }}
          >
            {operation.label}
          </Button>
        ))}
      </div>
      <small className="footnote operation-interaction-note">
        仅页面交互，不发送设备指令。任务进度和设备观测保持原值。
      </small>
      {recent && (
        <div className="operation-last-click" aria-live="polite">
          <small>最近页面操作 · {dateTime(recent.at)}</small>
          <span>已点击“{recent.label}”，未发送设备指令。</span>
        </div>
      )}
    </section>
  );
}
