package com.oneflight.flightcontrol;

import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.domain.Resource;
import com.oneflight.integration.DeviceDirectory;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.springframework.stereotype.Service;

@Service
public class FlightTargetResolver {
    private final TaskRepository tasks;
    private final ResourceRepository resources;
    private final ScopeService scope;
    private final DeviceDirectory directory;

    public FlightTargetResolver(TaskRepository tasks, ResourceRepository resources,
            ScopeService scope, DeviceDirectory directory) {
        this.tasks = tasks;
        this.resources = resources;
        this.scope = scope;
        this.directory = directory;
    }

    public Target resolve(String deviceId, String taskId) {
        String sourceId = clean(deviceId);
        if (clean(taskId) != null) {
            var task = tasks.findById(taskId).orElseThrow(ApiException::missing);
            scope.requireAccess(task);
            if (task.deviceId == null) throw ApiException.invalid("该任务尚未关联来源设备，请先完成设备分配");
            Resource resource = resources.findById(task.deviceId).orElseThrow(ApiException::missing);
            scope.requireResource(resource);
            if (!Objects.equals(task.organizationId, resource.organizationId)) {
                throw ApiException.invalid("任务与设备的组织关联已变化，请重新核对设备分配");
            }
            if (!"DEVICE".equals(resource.kind) || clean(resource.sourceDeviceId) == null) {
                throw ApiException.invalid("任务设备尚未绑定真实来源设备");
            }
            if (sourceId != null && !sourceId.equals(resource.sourceDeviceId)) {
                throw ApiException.invalid("设备与任务关联不一致，请重新进入");
            }
            sourceId = resource.sourceDeviceId;
        }
        if (sourceId == null) return new Target("/control-room", "请在飞控中选择设备；真实操作权限由飞控系统管理");
        var device = directory.require(sourceId);
        // Only this source type's native route has been verified. Airports/docks must not be guessed as aircraft.
        if ("UAV".equals(device.type())) {
            return new Target("/control-room/uav/" + URLEncoder.encode(device.id(), StandardCharsets.UTF_8)
                    .replace("+", "%20"), null);
        }
        return new Target("/control-room", "该设备类型的直达入口尚未验证，请在飞控中手动选择对应设备");
    }

    private static String clean(String value) { return value == null || value.isBlank() ? null : value; }
    public record Target(String path, String message) { }

    /** Entry policy has already checked the local task; this device came from the person's tree. */
    public Target personalTarget(com.oneflight.integration.SourceModels.Device device) {
        if ("UAV".equals(device.type())) {
            return new Target("/control-room/uav/" + URLEncoder.encode(device.id(), StandardCharsets.UTF_8)
                    .replace("+", "%20"), null);
        }
        return new Target("/source/UAV_AIRPORT", "当前任务设备：" + Objects.toString(device.name(), device.id())
                + "；请在飞控中手动选择对应设备，真实操作权限由飞控管理");
    }
}
