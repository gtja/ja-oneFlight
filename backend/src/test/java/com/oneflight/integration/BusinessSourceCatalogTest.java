package com.oneflight.integration;

import com.oneflight.auth.AccessScope;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
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
    @Test
    void circleGeometryPreservesEveryPointAtOrdinaryAndBoundaryLocations() throws Exception {
        // Cardinal coordinates captured before the refactor; tolerances permit platform Math rounding.
        List<CircleFixture> fixtures = List.of(
                new CircleFixture(120, 30, 200, List.of(
                        List.of(120.0, 30.00179864072745), List.of(120.0020768914161, 29.99999998370045),
                        List.of(120.0, 29.998201359272546), List.of(119.9979231085839, 29.99999998370045))),
                new CircleFixture(179.9999, 0, 1000, List.of(
                        List.of(179.99990000000003, 0.00899320363724538), List.of(-179.99110679636271, 0.0),
                        List.of(179.99990000000003, -0.00899320363724538), List.of(179.99090679636276, 0.0))),
                new CircleFixture(-45, 89.99, 2000, List.of(
                        List.of(135.0, 89.99201359270332), List.of(15.927018099347038, 89.9794206209171),
                        List.of(-45.0, 89.97201359272901), List.of(-105.92701809934698, 89.9794206209171))),
                new CircleFixture(0, -30, 10_000_000, List.of(
                        List.of(0.0, 59.9320363724538), List.of(89.94114176511027, -0.0339818077963542),
                        List.of(-180.0, -60.06796362754619), List.of(-89.94114176511033, -0.03398180779636635))));
        for (CircleFixture fixture : fixtures) {
            var raw = ProviderJson.JSON.valueToTree(List.of(
                    List.of(fixture.longitude(), fixture.latitude(), 0, fixture.radius())));
            Map<String, Object> geometry = BusinessSourceCatalog.zoneGeometry("CIRCULAR", raw);
            assertEquals("Polygon", geometry.get("type"));
            List<?> ring = (List<?>) ((List<?>) geometry.get("coordinates")).getFirst();
            assertEquals(65, ring.size());
            assertEquals(ring.getFirst(), ring.getLast());
            for (int index = 0; index < fixture.cardinals().size(); index++) {
                List<?> point = (List<?>) ring.get(index * 16);
                List<Double> expected = fixture.cardinals().get(index);
                assertEquals(expected.get(0), ((Number) point.get(0)).doubleValue(), 1e-10);
                assertEquals(expected.get(1), ((Number) point.get(1)).doubleValue(), 1e-10);
            }
            for (Object value : ring) {
                List<?> point = (List<?>) value;
                double longitude = ((Number) point.get(0)).doubleValue();
                double latitude = ((Number) point.get(1)).doubleValue();
                assertTrue(longitude >= -180 && longitude <= 180);
                assertTrue(latitude >= -90 && latitude <= 90);
                assertEquals(fixture.radius(), distanceMeters(fixture.longitude(), fixture.latitude(), longitude, latitude), 0.005);
            }
        }
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
    private double distanceMeters(double fromLongitude, double fromLatitude, double toLongitude, double toLatitude) {
        double sinHalfLatitude = Math.sin(Math.toRadians(toLatitude - fromLatitude) / 2);
        double sinHalfLongitude = Math.sin(Math.toRadians(toLongitude - fromLongitude) / 2);
        double haversine = sinHalfLatitude * sinHalfLatitude
                + Math.cos(Math.toRadians(fromLatitude)) * Math.cos(Math.toRadians(toLatitude))
                * sinHalfLongitude * sinHalfLongitude;
        return 2 * 6_371_008.8 * Math.asin(Math.sqrt(haversine));
    }
    private record CircleFixture(double longitude, double latitude, double radius, List<List<Double>> cardinals) { }
}
