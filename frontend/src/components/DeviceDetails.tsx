import type { Entity } from "../api";
import { dateTime } from "../domain";
import {
  resolveDevicePresentation,
  showsFlightHistory,
} from "../devicePresentation";
import DeviceFlightHistory from "./DeviceFlightHistory";
import { Details, Status } from "./UI";

/** Receives an already authorized source record, never a guessed source identity. */
export default function DeviceDetails({ device }: { device: Entity }) {
  const presentation = resolveDevicePresentation(device);
  return (
    <div className="device-details">
      <Details
        items={[
          { label: "设备类型", value: presentation.label },
          ...(presentation.rawType
            ? [{ label: "来源类型", value: presentation.rawType }]
            : []),
          { label: "设备编号", value: device.id },
          { label: "序列号", value: String(device.sn || "—") },
          { label: "来源状态", value: <Status status={device.status} /> },
          { label: "末次观测", value: dateTime(device.lastObservedAt) },
          { label: "经度（WGS84）", value: String(device.longitude ?? "未知") },
          { label: "纬度（WGS84）", value: String(device.latitude ?? "未知") },
        ]}
      />
      {showsFlightHistory(device) && <DeviceFlightHistory device={device} />}
    </div>
  );
}
