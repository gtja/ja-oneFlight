package com.oneflight.integration;

import com.oneflight.auth.AccessScope;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.oneflight.domain.Resource;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.service.AuditService;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BusinessSourceImporterTest {
    private AccessScope scope(Role role) {
        AccessScope scope = mock(AccessScope.class);
        when(scope.currentUser()).thenReturn(new CurrentUser("admin", "admin", "Admin", role, "local-org", Set.of(), Set.of("A")));
        return scope;
    }
    private DeviceDirectory directory() {
        DeviceDirectory directory = mock(DeviceDirectory.class); when(directory.allowedIds()).thenReturn(Set.of("A"));
        when(directory.authorized()).thenReturn(Map.of("A", new SourceModels.Device("A", "P", "真实飞机", "UAV", "SN", "source-org", null, null, null, "UNKNOWN", null, null)));
        return directory;
    }
    private Map<String, Object> person(String id) { return Map.of("id", id, "sourceId", id, "title", "来源人员", "sourceSystem", "ja-4a", "sourceEntity", "users", "sourceOrganizationCode", "source-org", "qualificationStatus", "UNKNOWN"); }
    @Test void idempotentSourceImportsRetainManualPersonnelAndNeverGivePilotsOrDeviceCommands() throws Exception {
        var catalog = mock(BusinessSourceCatalog.class); var resources = mock(ResourceRepository.class); var organizations = mock(OrganizationRepository.class); var audit = mock(AuditService.class);
        List<Resource> saved = new ArrayList<>(); Resource manual = new Resource(); manual.title = "既有手工人员"; manual.kind = "PERSON"; manual.status = "ACTIVE"; saved.add(manual);
        when(resources.findAll()).thenAnswer(call -> new ArrayList<>(saved)); when(resources.save(any())).thenAnswer(call -> { Resource value = call.getArgument(0); saved.add(value); return value; });
        when(catalog.list("people", 1, 50)).thenReturn(new PageResult<>(List.of(person("9223372036854775807")), 1, 1, 50));
        var importer = new BusinessSourceImporter(catalog, directory(), resources, organizations, scope(Role.ADMIN), audit);
        Map<?, ?> first = (Map<?, ?>) importer.importArchives(Set.of("PERSON"), 50).get("PERSON"); assertEquals(1, first.get("imported"));
        Map<?, ?> second = (Map<?, ?>) importer.importArchives(Set.of("PERSON"), 50).get("PERSON"); assertEquals(0, second.get("imported")); assertEquals(1, second.get("skipped"));
        assertEquals(2, saved.size()); assertEquals("ACTIVE", manual.status); assertEquals("既有手工人员", manual.title);
        Resource imported = saved.get(1); assertEquals("PENDING_CONFIRMATION", imported.status); assertEquals("local-org", imported.organizationId); assertNull(imported.sourceDeviceId);
        var metadata = ProviderJson.JSON.readTree(imported.metadata); assertEquals("UNKNOWN", metadata.path("qualificationStatus").asText());
        assertEquals("9223372036854775807", metadata.path("sourceImport").path("id").asText());
        assertEquals("SOURCE_IMPORTED", ProviderJson.JSON.readTree(imported.provenance).path("origin").asText());
    }
    @Test void existingDeviceBindingIsPreservedRatherThanDuplicated() {
        var resources = mock(ResourceRepository.class); var existing = new Resource(); existing.sourceDeviceId = "A"; existing.kind = "DEVICE"; existing.status = "ACTIVE";
        when(resources.findAll()).thenReturn(List.of(existing)); var importer = new BusinessSourceImporter(mock(BusinessSourceCatalog.class), directory(), resources, mock(OrganizationRepository.class), scope(Role.ADMIN), mock(AuditService.class));
        Map<?, ?> result = (Map<?, ?>) importer.importArchives(Set.of("DEVICE"), 50).get("DEVICE"); assertEquals(0, result.get("imported")); assertEquals(1, result.get("skipped")); verify(resources, never()).save(any()); assertEquals("ACTIVE", existing.status);
    }
    @Test void multiplePagesKeepConstantSizeToAvoidRepeatingEarlierRecords() {
        var catalog = mock(BusinessSourceCatalog.class); var resources = mock(ResourceRepository.class); when(resources.findAll()).thenReturn(List.of());
        List<Map<String, Object>> first = new ArrayList<>(), second = new ArrayList<>(); for (int i = 1; i <= 100; i++) { first.add(person(Integer.toString(i))); } for (int i = 101; i <= 150; i++) { second.add(person(Integer.toString(i))); }
        when(catalog.list("people", 1, 100)).thenReturn(new PageResult<>(first, 150, 1, 100)); when(catalog.list("people", 2, 100)).thenReturn(new PageResult<>(second, 150, 2, 100));
        var importer = new BusinessSourceImporter(catalog, directory(), resources, mock(OrganizationRepository.class), scope(Role.ADMIN), mock(AuditService.class));
        Map<?, ?> result = (Map<?, ?>) importer.importArchives(Set.of("PERSON"), 150).get("PERSON"); assertEquals(150, result.get("imported")); verify(catalog).list("people", 2, 100);
        ArgumentCaptor<Resource> rows = ArgumentCaptor.forClass(Resource.class); verify(resources, times(150)).save(rows.capture()); assertEquals(150, rows.getAllValues().stream().map(r -> r.id).distinct().count());
    }
    @Test void nonAdminAndUnsupportedImportKindsCannotWriteBusinessData() {
        var resources = mock(ResourceRepository.class); var importer = new BusinessSourceImporter(mock(BusinessSourceCatalog.class), directory(), resources, mock(OrganizationRepository.class), scope(Role.DISPATCH), mock(AuditService.class));
        assertEquals("FORBIDDEN", assertThrows(ApiException.class, () -> importer.importArchives(Set.of("PERSON"), 50)).getCode()); verifyNoInteractions(resources);
        var admin = new BusinessSourceImporter(mock(BusinessSourceCatalog.class), directory(), resources, mock(OrganizationRepository.class), scope(Role.ADMIN), mock(AuditService.class));
        assertThrows(ApiException.class, () -> admin.importArchives(Set.of("TASK"), 50)); assertThrows(ApiException.class, () -> admin.importArchives(Set.of("DEVICE"), 2001));
    }
}
