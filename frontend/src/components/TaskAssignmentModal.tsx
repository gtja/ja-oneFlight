import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useData, write, type Entity } from "../api";
import { dateTime, statusLabel } from "../domain";
import type { Navigate } from "../navigation";
import {
  assignmentSelection,
  type TaskAssignmentOptions,
} from "../taskAssignment";
import { useMutationFeedback } from "./Workflow";
import { Button, Empty, Modal } from "./UI";
import { SelectControl } from "./SelectControl";

type PlanOption = { value: string; label: string; status?: string };
export default function TaskAssignmentModal({
  task,
  plans,
  plansLoading = false,
  plansError,
  currentPlanStatus,
  navigate,
  onClose,
}: {
  task: Entity;
  plans: PlanOption[];
  plansLoading?: boolean;
  plansError?: Error | null;
  currentPlanStatus?: string;
  navigate: Navigate;
  onClose: () => void;
}) {
  const [deviceId, setDeviceId] = useState("");
  const path = `/tasks/${task.id}/assignment-options${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ""}`;
  const options = useData<TaskAssignmentOptions>(path, true, 15_000);
  const mutate = useMutationFeedback();
  const client = useQueryClient();
  return (
    <Modal title="分配执行资源" onClose={onClose} wide>
      <TaskAssignmentForm
        task={task}
        plans={plans}
        plansLoading={plansLoading}
        plansError={plansError}
        currentPlanStatus={currentPlanStatus}
        options={options.data}
        loading={options.isLoading || options.isFetching}
        error={options.error}
        deviceId={deviceId}
        onDeviceChange={setDeviceId}
        navigate={navigate}
        onClose={onClose}
        onRetry={() => void options.refetch()}
        onSubmit={async (body) => {
          try {
            await mutate(
              () =>
                write(`/tasks/${task.id}/actions`, {
                  ...body,
                  action: "ASSIGN",
                }),
              "执行资源已分配，已批计划直接沿用审批结果",
            );
          } catch (error) {
            void client.invalidateQueries({ queryKey: [path] });
            throw error;
          }
        }}
      />
    </Modal>
  );
}

export function TaskAssignmentForm({
  task,
  plans,
  plansLoading = false,
  plansError,
  currentPlanStatus,
  options,
  loading = false,
  error,
  deviceId,
  onDeviceChange,
  navigate,
  onClose,
  onRetry,
  onSubmit,
}: {
  task: Entity;
  plans: PlanOption[];
  plansLoading?: boolean;
  plansError?: Error | null;
  currentPlanStatus?: string;
  options?: TaskAssignmentOptions;
  loading?: boolean;
  error?: Error | null;
  deviceId: string;
  onDeviceChange: (id: string) => void;
  navigate: Navigate;
  onClose: () => void;
  onRetry: () => void;
  onSubmit: (body: Record<string, string>) => Promise<unknown>;
}) {
  const [pilotId, setPilotId] = useState("");
  const [planId, setPlanId] = useState(String(task.planId || ""));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const gate = assignmentSelection(options, deviceId, pilotId, loading, error);
  const selectedPlan = plans.find((plan) => plan.value === planId);
  const invalidPlanSelection =
    !!planId && (plansLoading || !!plansError || !selectedPlan);
  const selectedPlanStatus =
    (planId === task.planId ? currentPlanStatus : undefined) ||
    selectedPlan?.status;
  const selectedDevice = options?.devices.find((item) => item.id === deviceId);
  const selectedPilot = options?.pilots.find((item) => item.id === pilotId);
  const canUsePilotOptions =
    !!deviceId && options?.selectedDeviceId === deviceId && !loading && !error;
  const ineligibleDevices =
    options?.devices.filter((item) => !item.eligible) || [];
  const ineligiblePilots =
    options?.pilots.filter((item) => !item.eligible) || [];
  useEffect(() => {
    if (!options || loading || error || options.selectedDeviceId !== deviceId)
      return;
    if (
      pilotId &&
      !options.pilots.some((item) => item.id === pilotId && item.eligible)
    )
      setPilotId("");
  }, [options, loading, error, deviceId, pilotId]);
  const leaveFor = (view: string, userId?: string) => {
    onClose();
    navigate(view, userId ? { userId } : undefined);
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!gate.ready || invalidPlanSelection || busy) return;
    setBusy(true);
    setSubmitError("");
    try {
      await onSubmit({ deviceId, pilotId, planId, note });
      onClose();
    } catch (reason) {
      setSubmitError(
        reason instanceof Error
          ? reason.message
          : "分配失败，请重新检查资源可用范围。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="task-assignment"
      onSubmit={submit}
      data-testid="task-assignment-form"
    >
      <div className="assignment-context">
        <div>
          <small>当前任务</small>
          <strong>{String(task.title || "任务")}</strong>
        </div>
        <div>
          <small>作业区域</small>
          <strong>{options?.region || task.region || "未设置"}</strong>
        </div>
        <div>
          <small>期望时间</small>
          <strong>
            {dateTime(options?.startAt || task.startAt)} —{" "}
            {dateTime(options?.endAt || task.endAt)}
          </strong>
        </div>
      </div>
      {options && !error && (
        <div className="assignment-summary" aria-label="设备接入与任务分配范围">
          <p>
            当前可见设备 <strong>{options.summary.deviceCount}</strong> 台 ·
            可调度 <strong>{options.summary.activeDeviceCount}</strong> 台 ·
            待确认 <strong>{options.summary.pendingDeviceCount}</strong> 台
          </p>
          <span>
            设备接入后可查看观测数据；待确认的设备须先完善调度资料。本任务有{" "}
            <strong>{options.summary.availableDeviceCount}</strong>{" "}
            台设备具备匹配飞手。
          </span>
          <Button small onClick={() => leaveFor("resources")}>
            完善设备调度资料 <ArrowRight size={12} />
          </Button>
        </div>
      )}
      {error && (
        <div className="assignment-load-error">
          <Empty error={error} />
          <Button onClick={onRetry}>重新检查可用范围</Button>
        </div>
      )}
      {loading && !options && (
        <Empty loading description="正在检查设备、飞手权限和时间安排。" />
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="assignment-deviceId">
            执行设备<em>*</em>
          </label>
          <SelectControl
            id="assignment-deviceId"
            value={deviceId}
            disabled={loading || !!error || !options || busy}
            required
            searchable
            placeholder="请选择执行设备"
            options={[
              { value: "", label: "请选择执行设备" },
              ...(options?.devices.map((item) => ({
                value: item.id,
                label: item.title,
                disabled: !item.eligible,
                description: item.eligible
                  ? item.compatiblePilotCount
                    ? `${item.compatiblePilotCount} 名匹配飞手`
                    : "暂无匹配飞手"
                  : item.reasons.map((reason) => reason.message).join("；") ||
                    statusLabel(item.status),
                group: item.eligible ? undefined : "暂不可分配",
              })) || []),
            ]}
            onChange={(value) => {
              setPilotId("");
              setSubmitError("");
              onDeviceChange(value);
            }}
          />
          {selectedDevice && (
            <span>
              设备驻地：{selectedDevice.region || "待确认"}
              ；按任务作业区域核验飞手权限。
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="assignment-pilotId">
            执行飞手<em>*</em>
          </label>
          <SelectControl
            id="assignment-pilotId"
            value={pilotId}
            disabled={!canUsePilotOptions || busy}
            required
            searchable
            placeholder={
              !deviceId
                ? "先选择执行设备"
                : loading
                  ? "正在检查匹配飞手"
                  : "请选择可用飞手"
            }
            options={[
              {
                value: "",
                label: !deviceId
                  ? "先选择执行设备"
                  : loading
                    ? "正在检查匹配飞手"
                    : "请选择可用飞手",
              },
              ...(options?.pilots.map((item) => ({
                value: item.id,
                label: item.title,
                disabled: !item.eligible,
                description: item.eligible
                  ? undefined
                  : item.reasons.map((reason) => reason.message).join("；"),
              })) || []),
            ]}
            onChange={(value) => {
              setPilotId(value);
              setSubmitError("");
            }}
          />
          <span>核验账号启用、任务区域、设备授权及该时段占用。</span>
        </div>
        <div className="field wide">
          <label htmlFor="assignment-planId">关联飞行计划</label>
          <SelectControl
            id="assignment-planId"
            value={planId}
            disabled={busy || plansLoading || !!plansError}
            searchable
            placeholder="稍后关联日常或长期计划"
            onChange={setPlanId}
            options={[
              { value: "", label: "稍后关联日常或长期计划" },
              ...(planId && !selectedPlan
                ? [
                    {
                      value: planId,
                      label: plansLoading
                        ? "正在检查已关联计划…"
                        : "原关联计划不匹配或不可见，请更换",
                      disabled: true,
                    },
                  ]
                : []),
              ...plans,
            ]}
          />
          <span>
            {selectedPlanStatus === "APPROVED"
              ? "已批计划直接沿用，无需重复审批。分配后进入待执行，可使用对应设备的页面操作按钮。"
              : "仅显示同部门、同区域且覆盖本任务时段的计划。未审批的计划须先审核通过，再开始作业。"}{" "}
            当前不发送设备指令。
          </span>
          {!!plansError && (
            <span className="form-error">
              计划目录读取失败，请刷新后重试，避免误改已有绑定。
            </span>
          )}
          {!plansLoading && !plansError && !plans.length && (
            <span>
              暂无匹配的日常或长期计划；可先分配资源，随后前往飞行服务申请覆盖本次作业的计划。
            </span>
          )}
          {invalidPlanSelection && !plansLoading && !plansError && (
            <span className="form-error">
              原关联计划不覆盖当前任务范围或时段，请更换匹配计划，或选择“稍后关联”。
            </span>
          )}
          <Button
            small
            onClick={() => {
              onClose();
              navigate("services", { taskId: task.id });
            }}
          >
            前往飞行服务 <ArrowRight size={12} />
          </Button>
        </div>
      </div>
      <div
        className={`assignment-gate ${gate.ready && !invalidPlanSelection ? "ready" : "blocked"}`}
        role="status"
        data-assignment-ready={gate.ready && !invalidPlanSelection}
      >
        {gate.ready ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        <span>
          {invalidPlanSelection
            ? "请先确认或更换匹配本任务的飞行计划。"
            : gate.reason}
        </span>
      </div>
      {!!ineligiblePilots.length && !error && (
        <section className="assignment-blockers" aria-label="飞手不可分配原因">
          <h3>{deviceId ? "所选设备的飞手检查" : "当前任务的飞手检查"}</h3>
          {ineligiblePilots.map((pilot) => (
            <div className="assignment-blocker" key={pilot.id}>
              <div>
                <strong>{pilot.title}</strong>
                <p>
                  {pilot.reasons.map((reason) => reason.message).join("；")}
                </p>
                <small>
                  账号可见区域：
                  {pilot.regions.length
                    ? pilot.regions.join("、")
                    : "未限制区域"}
                  ；本次作业：{options?.region || task.region}
                </small>
              </div>
              <Button small onClick={() => leaveFor("settings", pilot.id)}>
                查看飞手权限 <ArrowRight size={12} />
              </Button>
            </div>
          ))}
        </section>
      )}
      {!!ineligibleDevices.length && !error && (
        <details className="assignment-device-reasons">
          <summary>
            查看暂不可分配设备及原因（{ineligibleDevices.length} 台）
          </summary>
          <div>
            {ineligibleDevices.map((device) => (
              <p key={device.id}>
                <strong>{device.title}</strong>
                <span>
                  {device.reasons.map((reason) => reason.message).join("；") ||
                    statusLabel(device.status)}
                </span>
              </p>
            ))}
          </div>
        </details>
      )}
      {selectedPilot && gate.ready && (
        <p className="assignment-selected">
          本次分配：{selectedDevice?.title} / {selectedPilot.title}
        </p>
      )}
      <div className="field assignment-note">
        <label htmlFor="assignment-note">办理说明</label>
        <textarea
          id="assignment-note"
          rows={2}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      {submitError && (
        <p className="form-error" role="alert">
          <AlertCircle size={14} />
          {submitError}
        </p>
      )}
      <div className="form-footer">
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button
          primary
          type="submit"
          disabled={!gate.ready || invalidPlanSelection || busy}
        >
          {busy ? "正在分配…" : "分配执行资源"}
        </Button>
      </div>
    </form>
  );
}
