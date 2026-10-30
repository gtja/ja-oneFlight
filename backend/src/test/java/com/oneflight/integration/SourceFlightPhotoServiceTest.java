package com.oneflight.integration;

import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.SourceMediaLinkRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.service.AuditService;
import com.oneflight.service.WorkflowService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SourceFlightPhotoServiceTest {
    @Test
    void mapsExternalDeviceIdToLocalAssignedDeviceForUniqueTaskMatch() {
        SourceFlightPhotoProvider provider = mock(SourceFlightPhotoProvider.class);
        DeviceDirectory directory = mock(DeviceDirectory.class);
        ScopeService scope = mock(ScopeService.class);
        ResourceRepository resources = mock(ResourceRepository.class);
        TaskRepository tasks = mock(TaskRepository.class);
        SourceMediaLinkRepository links = mock(SourceMediaLinkRepository.class);
        WorkflowService workflow = mock(WorkflowService.class);
        AuditService audit = mock(AuditService.class);

        Resource device = new Resource();
        device.id = "local-device-id";
        device.kind = "DEVICE";
        device.sourceDeviceId = "external-device-id";
        device.organizationId = "org-a";
        device.title = "Survey drone";

        Task task = new Task();
        task.id = "task-a";
        task.title = "Forest patrol";
        task.status = "EXECUTING";
        task.deviceId = device.id;
        task.startAt = Instant.parse("2026-10-29T01:00:00Z");
        task.endAt = Instant.parse("2026-10-29T03:00:00Z");

        SourceFlightPhoto photo = new SourceFlightPhoto(
                "source-photo-1", "PHOTOGRAPH", "forest-1.jpg", "external-device-id", "source-action",
                "source-item", "source-bid", "PICTURE", "VISIBLE", Instant.parse("2026-10-29T02:00:00Z"),
                Instant.parse("2026-10-29T02:00:00Z"), 120.1, 30.2, 80d,
                "/ja-media-storage/test/forest-1.jpg");

        when(scope.currentUser()).thenReturn(new CurrentUser(
                "admin", "admin", "Admin", Role.ADMIN, "org-a", Set.of(), Set.of(), Set.of()));
        when(scope.canRead(any(Resource.class))).thenReturn(true);
        when(scope.canRead(any(Task.class))).thenReturn(true);
        when(resources.findByKindAndSourceDeviceId("DEVICE", "external-device-id"))
                .thenReturn(List.of(device));
        when(resources.findById("local-device-id")).thenReturn(Optional.of(device));
        when(tasks.findByDeviceIdAndStatusNot("local-device-id", "CANCELLED"))
                .thenReturn(List.of(task));
        when(links.findBySourceSystemAndSourceDeviceIdAndSourceMediaId(
                "DUSHU", "external-device-id", "source-photo-1")).thenReturn(Optional.empty());
        when(provider.list(eq("external-device-id"), any(), any())).thenReturn(List.of(photo));

        SourceFlightPhotoService service = new SourceFlightPhotoService(
                provider, directory, scope, resources, tasks, links, workflow, audit);
        List<Map<String, Object>> result = service.listForDevice(
                "external-device-id", Instant.parse("2026-10-29T00:00:00Z"),
                Instant.parse("2026-10-29T04:00:00Z"), 1, 100);

        assertEquals(1, result.size());
        assertEquals("task-a", result.getFirst().get("taskId"));
        assertEquals("AUTO_MATCHED", result.getFirst().get("associationStatus"));
        assertEquals("source-action", result.getFirst().get("sourceActionId"));
        verify(resources).findByKindAndSourceDeviceId("DEVICE", "external-device-id");
        verify(tasks).findByDeviceIdAndStatusNot("local-device-id", "CANCELLED");
    }
}
