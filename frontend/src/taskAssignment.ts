export type AssignmentReason = { code: string; message: string };
export type AssignmentDevice = {
  id: string;
  title: string;
  status: string;
  region?: string;
  organizationId: string;
  organizationName?: string;
  eligible: boolean;
  reasons: AssignmentReason[];
  compatiblePilotCount: number;
};
export type AssignmentPilot = {
  id: string;
  title: string;
  organizationId: string;
  organizationName?: string;
  regions: string[];
  eligible: boolean;
  reasons: AssignmentReason[];
};
export type TaskAssignmentOptions = {
  taskId: string;
  taskStatus: string;
  region: string;
  organizationId: string;
  organizationName?: string;
  startAt?: string;
  endAt?: string;
  selectedDeviceId: string | null;
  summary: {
    deviceCount: number;
    activeDeviceCount: number;
    pendingDeviceCount: number;
    availableDeviceCount: number;
    pilotCount: number;
    availablePilotCount: number;
  };
  devices: AssignmentDevice[];
  pilots: AssignmentPilot[];
  reasons: AssignmentReason[];
};

/** The server owns assignment rules. Never infer availability from device status alone. */
export function assignmentSelection(
  options: TaskAssignmentOptions | undefined,
  deviceId: string,
  pilotId: string,
  loading = false,
  error?: Error | null,
) {
  if (error)
    return { ready: false, reason: "可用范围读取失败，请重新检查后分配。" };
  if (loading || !options)
    return { ready: false, reason: "正在检查设备、飞手权限和时间安排。" };
  if (options.reasons.length)
    return {
      ready: false,
      reason: options.reasons.map((r) => r.message).join("；"),
    };
  const device = options.devices.find((item) => item.id === deviceId);
  if (!device) return { ready: false, reason: "请选择执行设备。" };
  if (!device.eligible)
    return {
      ready: false,
      reason:
        device.reasons.map((r) => r.message).join("；") ||
        "所选设备暂不可分配。",
    };
  if (options.selectedDeviceId !== deviceId)
    return { ready: false, reason: "正在检查所选设备对应的飞手权限。" };
  const pilot = options.pilots.find((item) => item.id === pilotId);
  if (!pilot)
    return {
      ready: false,
      reason: options.pilots.some((item) => item.eligible)
        ? "请选择有权限且该时段可用的执行飞手。"
        : "当前设备没有符合任务区域、设备授权和时间要求的飞手。",
    };
  if (!pilot.eligible)
    return {
      ready: false,
      reason:
        pilot.reasons.map((r) => r.message).join("；") ||
        "所选飞手暂不可分配。",
    };
  return { ready: true, reason: "设备和飞手符合当前任务的分配条件。" };
}
