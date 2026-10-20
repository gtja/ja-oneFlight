package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneflight.auth.AccessScope;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.oneflight.integration.SourceModels.*;

class SourceContractTest {
    private SourceProperties properties() {
        return new SourceProperties(null, null, null, "test-token", "source-user", null, null, null,
                null, null, null, null, null, null, null, 2);
    }
    private AccessScope scope(Role role, Set<String> allowed) {
        AccessScope scope = mock(AccessScope.class);
        when(scope.currentUser()).thenReturn(new CurrentUser("local", "user", "User", role, "org", Set.of(), allowed));
        when(scope.allowedDeviceIds()).thenReturn(allowed); return scope;
    }
    private JsonNode node(String value) throws Exception { return ProviderJson.JSON.readTree(value); }
    private DeviceDirectory directory(ProviderHttpClient http, AccessScope scope) throws Exception {
        when(http.gateway(eq("/device/list/tree/v4"), anyMap())).thenReturn(node("{\"roots\":[{\"devices\":[{\"deviceId\":\"A\",\"productKey\":\"P\",\"deviceName\":\"飞机\",\"sn\":\"SA\",\"childrenDevices\":[{\"deviceId\":\"B\",\"productKey\":\"P\",\"sn\":\"SB\"}]}]}]}"));
        DeviceDirectory directory = new DeviceDirectory(properties(), http, scope); directory.refresh(); return directory;
    }
    @Test void envelopeRejectsBusinessErrorInsteadOfProducingEmptyResult() {
        ApiException exception = assertThrows(ApiException.class, () -> ProviderJson.envelope("{\"code\":\"ERROR\",\"data\":{\"rows\":[]}}"));
        assertEquals("SOURCE_UNAVAILABLE", exception.getCode());
        assertThrows(ApiException.class, () -> ProviderJson.envelope("html"));
        assertThrows(ApiException.class, () -> ProviderJson.envelope("{\"code\":\"SUCCESS\",\"data\":null}"));
    }
    @Test void nativeLargeIdsRemainStringsAndSecretsAreProjectedOut() throws Exception {
        Algorithm result = AlgorithmCatalog.mapAlgorithm(node("{\"id\":9223372036854775807,\"appName\":\"巡检\",\"deployed\":false,\"envMap\":\"secret\",\"defaultAlgorithmConfig\":\"secret\",\"tags\":[{\"tagKey\":\"algo_type\",\"tagValue\":\"火点\"}],\"deviceTypes\":\"UAV,UAV_DOCK\"}"));
        assertEquals("9223372036854775807", result.id()); assertFalse(result.deployed());
        assertEquals(List.of("UAV", "UAV_DOCK"), result.deviceTypes()); assertFalse(result.details().containsKey("envMap"));
        assertFalse(result.details().containsKey("defaultAlgorithmConfig"));
    }
    @Test void authorizedScopeIsIntersectionAndSourceFailureRevokesCache() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, scope(Role.DISPATCH, Set.of("A", "UNAUTHORIZED")));
        assertEquals(Set.of("A"), directory.allowedIds());
        assertThrows(ApiException.class, () -> directory.require("B"));
        when(http.gateway(eq("/device/list/tree/v4"), anyMap())).thenThrow(ProviderJson.failure("expired"));
        directory.refresh(); assertEquals(SourceState.ERROR, directory.health().state());
        assertThrows(ApiException.class, directory::authorized);
    }
    @Test void adminSeesSourceCatalogAndChildDeviceKeepsSeparateIdentity() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, scope(Role.ADMIN, Set.of()));
        assertEquals(Set.of("A", "B"), directory.allowedIds());
        assertEquals("A", directory.require("B").parentDeviceId());
        Map<String, String> topics = TelemetryReceiver.topics(directory.authorized());
        assertEquals("A", topics.get("thing/product/SA/osd")); assertEquals("B", topics.get("thing/product/SB/osd"));
        assertEquals(8, topics.size()); assertTrue(topics.keySet().stream().noneMatch(topic -> topic.contains("#") || topic.contains("+")));
    }
    @Test void deviceDetailReturnsOwnCumulativeCountersAndLatestObservationWithoutInheritingParents() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, scope(Role.ADMIN, Set.of()));
        SourceDatabase database = mock(SourceDatabase.class);
        TelemetryReceiver telemetry = mock(TelemetryReceiver.class);
        Instant reportedAt = Instant.parse("2026-10-15T00:00:00Z");
        FlightTotals counters = new FlightTotals(105L, 3661L, 23456.7, reportedAt);
        when(database.totals(Set.of("A"))).thenReturn(Map.of("A", counters));
        when(database.totals(Set.of("B"))).thenReturn(Map.of());
        when(telemetry.current(anyString())).thenAnswer(call -> new Telemetry(call.getArgument(0), "ONLINE", reportedAt,
                reportedAt, reportedAt, 120.5, 30.2, null, null, null, null, null, null));
        Device result = directory.detail("A", telemetry, database);
        assertEquals(counters, result.flightTotals()); assertEquals("ONLINE", result.status());
        assertEquals(120.5, result.longitude()); assertEquals(reportedAt, result.lastObservedAt());
        Device child = directory.detail("B", telemetry, database);
        assertEquals("A", child.parentDeviceId()); assertNull(child.flightTotals());
        verify(database).totals(Set.of("B"));
    }
    @Test void hasFlightTotalsFilterRunsBeforePagingAndReportsFilteredTotal() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, scope(Role.ADMIN, Set.of()));
        SourceDatabase database = mock(SourceDatabase.class);
        TelemetryReceiver telemetry = mock(TelemetryReceiver.class);
        when(database.totals(Set.of("A", "B"))).thenReturn(Map.of("B", new FlightTotals(12L, 3600L, 900.5, null)));
        when(telemetry.current(anyString())).thenAnswer(call -> new Telemetry(call.getArgument(0), "UNKNOWN", null,
                null, null, null, null, null, null, null, null, null, null));
        var filtered = directory.list(null, null, true, 1, 1, telemetry, database);
        assertEquals(1, filtered.total()); assertEquals("B", filtered.items().getFirst().id());
        var without = directory.list(null, null, false, 1, 1, telemetry, database);
        assertEquals(1, without.total()); assertEquals("A", without.items().getFirst().id());
        var all = directory.list(null, null, null, 1, 1, telemetry, database);
        assertEquals(2, all.total()); assertEquals("A", all.items().getFirst().id());
        assertEquals(0, directory.list("飞机", null, true, 1, 1, telemetry, database).total());
        assertEquals("B", directory.list("SB", null, true, 1, 1, telemetry, database).items().getFirst().id());
    }
    @Test void deviceCountersFailureDoesNotBecomeSuccessfulUnknownOrEmptyFilteredResult() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, scope(Role.ADMIN, Set.of()));
        SourceDatabase database = mock(SourceDatabase.class);
        TelemetryReceiver telemetry = mock(TelemetryReceiver.class);
        when(database.totals(anySet())).thenThrow(ProviderJson.failure("飞行累计统计读取失败，请重试"));
        assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class, () -> directory.detail("A", telemetry, database)).getCode());
        assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class, () -> directory.list(null, null, true, 1, 20, telemetry, database)).getCode());
        SourceDatabase unconfigured = new SourceDatabase(properties());
        try { assertEquals("SOURCE_UNAVAILABLE", assertThrows(ApiException.class, () -> unconfigured.totals(Set.of("A"))).getCode()); }
        finally { unconfigured.close(); }
    }
    @Test void deviceDetailRechecksAuthorizationAfterStatisticsRead() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, scope(Role.ADMIN, Set.of()));
        SourceDatabase database = mock(SourceDatabase.class);
        TelemetryReceiver telemetry = mock(TelemetryReceiver.class);
        when(telemetry.current("A")).thenReturn(new Telemetry("A", "UNKNOWN", null, null, null, null, null,
                null, null, null, null, null, null));
        when(database.totals(Set.of("A"))).thenAnswer(call -> {
            when(http.gateway(eq("/device/list/tree/v4"), anyMap())).thenThrow(ProviderJson.failure("revoked"));
            directory.refresh(); return Map.of();
        });
        assertThrows(ApiException.class, () -> directory.detail("A", telemetry, database));
    }
    @Test void malformedTelemetryUnknownTopologyAndDuplicateUpdatesDoNotInventFacts() throws Exception {
        Instant now = Instant.parse("2026-10-14T00:00:00Z");
        assertNull(TelemetryReceiver.parse("A", node("{\"sub_devices\":[{}]}"), node("{}"), now));
        Telemetry first = TelemetryReceiver.parse("A", node("{\"longitude\":120,\"latitude\":30,\"remainingPower\":60}"), node("{\"timestamp\":1791936000000}"), now);
        assertNotNull(first); assertEquals("ONLINE", first.status());
        Telemetry duplicate = new Telemetry("A", "OFFLINE", first.lastObservedAt(), now, null, null, null, null, null, null, null, null, null);
        assertSame(first, TelemetryReceiver.merge(first, duplicate));
        assertEquals("UNKNOWN", first.unknown().status()); assertEquals(120d, first.unknown().longitude());
        assertNull(TelemetryReceiver.parse("A", node("{\"longitude\":999,\"latitude\":-999,\"remainingPower\":999}"), node("{}"), now));
    }

    @Test void metricUpdatesKeepLastPositionTimestampAndDoNotMixCoordinatePairs() throws Exception {
        Instant firstAt = Instant.parse("2026-10-14T00:00:00Z");
        Telemetry first = TelemetryReceiver.parse("A", node("{\"longitude\":120,\"latitude\":30}"), node("{}"), firstAt);
        Telemetry metric = TelemetryReceiver.parse("A", node("{\"remainingPower\":40,\"latitude\":31}"), node("{}"), firstAt.plusSeconds(10));
        Telemetry merged = TelemetryReceiver.merge(first, metric);
        assertEquals(firstAt, merged.positionObservedAt()); assertEquals(30d, merged.latitude());
        assertEquals(firstAt.plusSeconds(10), merged.lastObservedAt()); assertEquals(40d, merged.batteryPercent());
    }
    @Test void windSpeedUnitIsPublishedOnlyForVerifiedDockOsdContract() throws Exception {
        Instant now = Instant.parse("2026-10-14T00:00:00Z");
        JsonNode payload = node("{\"wind_speed\":22,\"latitude\":30,\"longitude\":120}");
        assertNull(TelemetryReceiver.parse("A", payload, node("{}"), now, "UAV").windSpeed());
        assertEquals(22d, TelemetryReceiver.parse("A", payload, node("{}"), now, "UAV_AIRPORT").windSpeed());
        assertNull(TelemetryReceiver.parse("A", payload, node("{}"), now).windSpeed());
    }
    @Test void undeployedFilterFalseIsPreservedAndStatisticsDoNotAddPaging() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        when(http.algorithm(eq("/algorithm/app/list"), anyMap())).thenReturn(node("{\"rows\":[],\"total\":0}"));
        when(http.algorithm(eq("/algorithm/app/statistics"), anyMap())).thenReturn(node("{\"totalCount\":0,\"deployedCount\":0,\"undeployedCount\":0}"));
        AccessScope scope = scope(Role.ADMIN, Set.of());
        AlgorithmCatalog catalog = new AlgorithmCatalog(http, directory(http, scope), scope);
        catalog.list(" ", "火点", "UAV", "undeployed", 1, 20);
        ArgumentCaptor<Map<String, Object>> body = ArgumentCaptor.forClass(Map.class);
        verify(http).algorithm(eq("/algorithm/app/list"), body.capture());
        assertEquals(false, body.getValue().get("deployed")); assertFalse(body.getValue().containsKey("keyword"));
        assertEquals(List.of("UAV"), body.getValue().get("deviceType"));
        catalog.statistics(null, null, null);
        verify(http).algorithm(eq("/algorithm/app/statistics"), body.capture());
        assertFalse(body.getValue().containsKey("page")); assertFalse(body.getValue().containsKey("deployed"));
    }
    @Test void deploymentPaginationFiltersUnauthorizedDevicesBeforeReturningTotals() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        AccessScope scope = scope(Role.DISPATCH, Set.of("A"));
        DeviceDirectory directory = directory(http, scope);
        when(http.algorithm(eq("/algorithm/deploy/device/list"), anyMap())).thenReturn(node("{\"total\":2,\"rows\":[{\"deployRecordId\":\"1\",\"deviceId\":\"A\",\"deviceName\":\"可见\"},{\"deployRecordId\":\"2\",\"deviceId\":\"B\",\"deviceName\":\"不可见\"}]}"));
        var result = new AlgorithmCatalog(http, directory, scope).deployments("123", 1, 20);
        assertEquals(1, result.total()); assertEquals("A", result.items().getFirst().deviceId());
    }
    @Test void deploymentRepeatedPageFailsInsteadOfReturningPartialSuccess() throws Exception {
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        AccessScope scope = scope(Role.ADMIN, Set.of());
        DeviceDirectory directory = directory(http, scope);
        when(http.algorithm(eq("/algorithm/deploy/device/list"), anyMap())).thenReturn(node("{\"total\":2,\"rows\":[{\"deployRecordId\":\"1\",\"deviceId\":\"A\"}]}"));
        assertThrows(ApiException.class, () -> new AlgorithmCatalog(http, directory, scope).deployments("123", 1, 20));
    }
    @Test void unsupportedControlAlwaysReturnsProviderNotConfigured() {
        for (FlightCommandGateway.Command command : FlightCommandGateway.Command.values()) {
            ApiException exception = assertThrows(ApiException.class, () -> new UnavailableFlightCommandGateway().execute("A", command));
            assertEquals("PROVIDER_NOT_CONFIGURED", exception.getCode()); assertEquals(501, exception.getStatus().value());
        }
    }
    @Test void adminStatusAndUnavailableControlEnforceScopeBeforeAnyGatewayOperation() throws Exception {
        AccessScope admin = scope(Role.ADMIN, Set.of());
        ProviderHttpClient http = mock(ProviderHttpClient.class);
        DeviceDirectory directory = directory(http, admin);
        TelemetryReceiver telemetry = mock(TelemetryReceiver.class);
        SourceDatabase database = mock(SourceDatabase.class);
        AlgorithmCatalog catalog = mock(AlgorithmCatalog.class);
        var controller = new IntegrationController(directory, telemetry, database, catalog,
                new UnavailableFlightCommandGateway(), new UnavailableSourceExtensions(), admin);
        ApiException unavailable = assertThrows(ApiException.class, () -> controller.command("A", new IntegrationController.CommandRequest(FlightCommandGateway.Command.TAKEOFF)));
        assertEquals("PROVIDER_NOT_CONFIGURED", unavailable.getCode());
        ApiException forbidden = assertThrows(ApiException.class, () -> controller.command("NOT_AUTHORIZED", new IntegrationController.CommandRequest(FlightCommandGateway.Command.TAKEOFF)));
        assertEquals("FORBIDDEN", forbidden.getCode());
        AccessScope department = scope(Role.DEPARTMENT, Set.of("A"));
        var restricted = new IntegrationController(directory, telemetry, database, catalog,
                new UnavailableFlightCommandGateway(), new UnavailableSourceExtensions(), department);
        assertEquals("FORBIDDEN", assertThrows(ApiException.class, restricted::status).getCode());
        assertEquals("FORBIDDEN", assertThrows(ApiException.class, restricted::refresh).getCode());
    }
    @Test void boundedHistoryCacheSeparatesScopesAndExpiresWithoutServingOldRecords() {
        var cache = new SourceReadCache<String>(java.time.Clock.fixed(Instant.EPOCH, java.time.ZoneOffset.UTC), java.time.Duration.ofSeconds(30));
        cache.put("A|page1", "only A"); assertEquals("only A", cache.get("A|page1")); assertNull(cache.get("A,B|page1"));
        cache.clear(); assertNull(cache.get("A|page1"));
        var expired = new SourceReadCache<String>(java.time.Clock.fixed(Instant.EPOCH, java.time.ZoneOffset.UTC), java.time.Duration.ZERO);
        expired.put("A|page1", "expired"); assertNull(expired.get("A|page1"));
    }
    @Test void sourceUnitAndSettlementMappingKeepsUnknownValuesUnknown() {
        assertEquals("PENDING", SourceDatabase.settlement(0)); assertEquals("SETTLED", SourceDatabase.settlement(1));
        assertEquals("UNKNOWN", SourceDatabase.settlement(null)); assertEquals("UNKNOWN", SourceDatabase.settlement(9));
        assertFalse(ProviderJson.validTopicPart("A/#")); assertFalse(ProviderJson.validTopicPart("+"));
    }
}
