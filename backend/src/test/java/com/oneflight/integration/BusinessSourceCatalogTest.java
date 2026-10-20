package com.oneflight.integration;

import com.oneflight.auth.AccessScope;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import java.util.*;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class BusinessSourceCatalogTest {
    private AccessScope scope(Role role) {
        AccessScope scope = mock(AccessScope.class);
        when(scope.currentUser()).thenReturn(new CurrentUser("local-user", "local", "Admin", role, "local-org", Set.of(), Set.of("A")));
        return scope;
    }
    private DeviceDirectory directory() {
        DeviceDirectory directory = mock(DeviceDirectory.class);
        when(directory.allowedIds()).thenReturn(Set.of("A"));
        when(directory.authorized()).thenReturn(Map.of("A", new SourceModels.Device("A", "P", "Device", "UAV", null, "org-X", null, null, null, "UNKNOWN", null, null), "B", new SourceModels.Device("B", "P", "Other", "UAV", null, "org-Y", null, null, null, "UNKNOWN", null, null)));
        return directory;
    }
    private JdbcTemplate identity() {
        JdbcDataSource source = new JdbcDataSource(); source.setURL("jdbc:h2:mem:source_" + UUID.randomUUID() + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        JdbcTemplate jdbc = new JdbcTemplate(source);
        jdbc.execute("CREATE TABLE users(user_id BIGINT,name VARCHAR(200),group_id VARCHAR(50),disable INT,create_at TIMESTAMP,update_at TIMESTAMP,password VARCHAR(200),phone VARCHAR(20),id_card VARCHAR(20),license VARCHAR(200))");
        jdbc.execute("CREATE TABLE `groups`(group_id VARCHAR(50),group_name VARCHAR(200),group_parent_id VARCHAR(50),group_order INT)");
        jdbc.update("INSERT INTO `groups` VALUES('org-X','设备来源组织',NULL,1),('org-Y','不可见组织',NULL,2)");
        jdbc.update("INSERT INTO users VALUES(9223372036854775807,'真实姓名 13812345678','org-X',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'never expose','13812345678','never expose','never expose'),(2,'不可见人员','org-Y',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'x','x','x','x')");
        return jdbc;
    }
    @Test void personnelProjectionFiltersByAuthorizedDeviceOrganizationWithoutReadingCredentials() {
        try (BusinessSourceCatalog catalog = catalog(directory(), scope(Role.ADMIN), identity())) {
            var result = catalog.list("people", 1, 20); assertEquals(1, result.total());
            var row = result.items().getFirst(); assertEquals("9223372036854775807", row.get("id"));
            assertEquals("真实姓名 [手机号已隐藏]", row.get("title")); assertEquals("UNKNOWN", row.get("qualificationStatus"));
            assertEquals("UNKNOWN", row.get("sourceStatus")); assertEquals("org-X", row.get("sourceOrganizationCode"));
            for (String key : List.of("password", "phone", "idCard", "license", "username")) { assertFalse(row.containsKey(key)); }
            assertEquals(1, catalog.list("groups", 1, 20).total());
            assertEquals(0, catalog.list("people", 1, 20, "不可见", null).total());
            assertEquals(1, catalog.list("people", 1, 20, "真实姓名", null).total());
            assertTrue(catalog.list("people", 2, 20).items().isEmpty());
        }
    }
    @Test void failedSourceCannotTurnIntoAZeroCountAndScopeIsRecheckedAfterReading() {
        var directory = directory(); var catalog = catalog(directory, scope(Role.ADMIN), identity());
        when(directory.allowedIds()).thenReturn(Set.of("A"), Set.of());
        assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class, () -> catalog.list("people", 1, 20)).getCode());
        var missing = catalog(directory(), scope(Role.ADMIN), null);
        assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class, () -> missing.list("people", 1, 20)).getCode());
        Map<?, ?> summary = (Map<?, ?>) missing.summary().get("people"); assertNull(summary.get("total")); assertEquals("ERROR", summary.get("status"));
    }
    @Test void changedSourceOrganizationRevokesPersonnelReadEvenIfTheDeviceIdIsUnchanged() {
        var directory = directory(); var original = directory.authorized();
        var changed = Map.of("A", new SourceModels.Device("A", "P", "Device", "UAV", null, "org-Y", null, null, null, "UNKNOWN", null, null));
        when(directory.authorized()).thenReturn(original, changed);
        var catalog = catalog(directory, scope(Role.ADMIN), identity());
        assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class, () -> catalog.list("people", 1, 20)).getCode());
    }
    @Test void departmentCannotEnumerateSourcePersonnelAndMalformedPagingIsRejected() {
        var directory = directory(); var catalog = catalog(directory, scope(Role.DEPARTMENT), identity());
        assertEquals("FORBIDDEN", assertThrows(ApiException.class, () -> catalog.list("people", 1, 20)).getCode());
        verify(directory, never()).allowedIds();
        assertThrows(ApiException.class, () -> BusinessSourceCatalog.pagination(0, 20));
        assertThrows(ApiException.class, () -> BusinessSourceCatalog.pagination(1, 101));
    }
    @Test void nativeRouteAndCircleGeometryKeepRealCoordinatesAndMissingGeometryUnknown() throws Exception {
        String data = "{\"spaces\":[{\"spaceType\":\"MAP\",\"positions\":[{\"pointX\":120.1,\"pointY\":30.1,\"pointZ\":20},{\"pointX\":120.2,\"pointY\":30.2,\"pointZ\":30}]}]}";
        assertEquals("LineString", BusinessSourceCatalog.routeGeometry(data).get("type"));
        assertNull(BusinessSourceCatalog.routeGeometry("{\"spaces\":[]}"));
        assertNull(BusinessSourceCatalog.routeGeometry(data.replace("MAP", "LOCAL")));
        var circle = BusinessSourceCatalog.zoneGeometry("CIRCULAR", ProviderJson.JSON.readTree("[[120,30,1409,200]]"));
        assertEquals("Polygon", circle.get("type"));
        List<?> ring = (List<?>) ((List<?>) circle.get("coordinates")).getFirst(); assertEquals(65, ring.size()); assertEquals(ring.getFirst(), ring.getLast());
        double firstLat = ((Number) ((List<?>) ring.getFirst()).get(1)).doubleValue(); assertTrue(firstLat > 30.001 && firstLat < 30.003);
        assertNull(BusinessSourceCatalog.zoneGeometry("CIRCULAR", ProviderJson.JSON.readTree("[[120,30,1409]]")));
    }
    @Test void nativeHistoricalTasksKeepUnknownValidityAndExcludeInvalidOrMixedScopeRecords() {
        JdbcTemplate jdbc = identity();
        jdbc.execute("CREATE TABLE action(id BIGINT,name VARCHAR(200),status VARCHAR(30),is_valid VARCHAR(20),type VARCHAR(20),action_scene VARCHAR(50),action_plan_id BIGINT,gmt_create TIMESTAMP,gmt_modified TIMESTAMP)");
        jdbc.execute("CREATE TABLE action_item_record(action_id BIGINT,device_id VARCHAR(50))");
        jdbc.update("INSERT INTO action VALUES(1,'历史行动','FINISHED',NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),(2,'无效行动','FINISHED','NO',NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),(3,'范围外行动','FINISHED','YES',NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),(4,'混合范围','FINISHED','YES',NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        jdbc.update("INSERT INTO action_item_record VALUES(1,'A'),(2,'A'),(3,'B'),(4,'A'),(4,'B')");
        var catalog = new BusinessSourceCatalog(directory(), scope(Role.ADMIN), null, jdbc, null);
        var data = catalog.list("tasks", 1, 20); assertEquals(1, data.total());
        var row = data.items().getFirst(); assertEquals("1", row.get("id")); assertEquals("FINISHED", row.get("sourceStatus"));
        assertNull(row.get("sourceValidity")); assertEquals("NOT_RECORDED", row.get("acceptanceStatus"));
    }
    @Test void scopeRequiresEveryNativeDeviceAndIdentitySchemaKeepsJdbcOptions() {
        assertTrue(BusinessSourceCatalog.allDevicesAllowed("A,B", Set.of("A", "B")));
        assertFalse(BusinessSourceCatalog.allDevicesAllowed("A,C", Set.of("A", "B")));
        assertFalse(BusinessSourceCatalog.allDevicesAllowed("A,", Set.of("A")));
        assertFalse(BusinessSourceCatalog.allDevicesAllowed(null, Set.of("A")));
        assertEquals("jdbc:mysql://host:31306/ja-4a?serverTimezone=Asia/Shanghai", BusinessSourceCatalog.identityUrl("jdbc:mysql://host:31306/dushu?serverTimezone=Asia/Shanghai"));
    }
    private BusinessSourceCatalog catalog(DeviceDirectory directory, AccessScope scope, JdbcTemplate identity) { return new BusinessSourceCatalog(directory, scope, null, null, identity); }
}
