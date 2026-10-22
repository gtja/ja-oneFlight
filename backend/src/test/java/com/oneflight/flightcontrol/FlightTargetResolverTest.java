package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.oneflight.auth.ScopeService;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.integration.DeviceDirectory;
import com.oneflight.integration.SourceModels.Device;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class FlightTargetResolverTest {
    TaskRepository tasks = mock(TaskRepository.class);
    ResourceRepository resources = mock(ResourceRepository.class);
    ScopeService scope = mock(ScopeService.class);
    DeviceDirectory directory = mock(DeviceDirectory.class);
    FlightTargetResolver resolver = new FlightTargetResolver(tasks, resources, scope, directory);

    private Device device(String id, String type) {
        return new Device(id, null, "device", type, null, null, null, null, null, null, null, null);
    }

    @Test void taskResolvesLocalArchiveToSourceAircraftBeforeRouting() {
        Task task = new Task(); task.deviceId = "local-device";
        Resource archive = new Resource(); archive.kind = "DEVICE"; archive.sourceDeviceId = "real-source";
        when(tasks.findById("task")).thenReturn(Optional.of(task));
        when(resources.findById("local-device")).thenReturn(Optional.of(archive));
        when(directory.require("real-source")).thenReturn(device("real-source", "UAV"));
        assertThat(resolver.resolve(null, "task").path()).isEqualTo("/control-room/uav/real-source");
        verify(scope).requireAccess(task);
        verify(scope).requireResource(archive);
        verify(directory, never()).require("local-device");
    }

    @Test void dockDoesNotGuessAnAircraftRoute() {
        when(directory.require("dock")).thenReturn(device("dock", "UAV_AIRPORT"));
        var result = resolver.resolve("dock", null);
        assertThat(result.path()).isEqualTo("/control-room");
        assertThat(result.message()).contains("手动选择");
    }

    @Test void conflictingDeviceAndTaskAreRejected() {
        Task task = new Task(); task.deviceId = "archive";
        Resource archive = new Resource(); archive.kind = "DEVICE"; archive.sourceDeviceId = "source-A";
        when(tasks.findById("task")).thenReturn(Optional.of(task));
        when(resources.findById("archive")).thenReturn(Optional.of(archive));
        assertThatThrownBy(() -> resolver.resolve("source-B", "task")).hasMessageContaining("不一致");
        verifyNoInteractions(directory);
    }

    @Test void unboundTaskNeverUsesLocalIdAsSourceId() {
        Task task = new Task(); task.deviceId = "archive";
        Resource archive = new Resource(); archive.kind = "DEVICE";
        when(tasks.findById("task")).thenReturn(Optional.of(task));
        when(resources.findById("archive")).thenReturn(Optional.of(archive));
        assertThatThrownBy(() -> resolver.resolve(null, "task")).hasMessageContaining("未绑定");
        verifyNoInteractions(directory);
    }

    @Test void upstreamPermissionDenialIsNotTurnedIntoAnotherDevice() {
        when(directory.require("source")).thenThrow(com.oneflight.common.ApiException.forbidden());
        assertThatThrownBy(() -> resolver.resolve("source", null)).hasMessageContaining("没有访问权限");
    }

    @Test void deviceMovedToAnotherOrganizationCannotUseStaleTaskAssignment() {
        Task task = new Task(); task.deviceId = "archive"; task.organizationId = "task-org";
        Resource archive = new Resource(); archive.kind = "DEVICE"; archive.sourceDeviceId = "source";
        archive.organizationId = "new-org";
        when(tasks.findById("task")).thenReturn(Optional.of(task));
        when(resources.findById("archive")).thenReturn(Optional.of(archive));
        assertThatThrownBy(() -> resolver.resolve(null, "task")).hasMessageContaining("组织关联已变化");
        verifyNoInteractions(directory);
    }
}
