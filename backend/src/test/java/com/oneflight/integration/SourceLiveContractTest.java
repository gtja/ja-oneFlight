package com.oneflight.integration;

import com.oneflight.auth.AccessScope;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Optional, strictly read-only smoke test. No credentials or raw responses are logged. */
@EnabledIfEnvironmentVariable(named = "SOURCE_LIVE_VERIFY", matches = "true")
class SourceLiveContractTest {
    private String env(String name) { return System.getenv(name); }
    @Test void verifiesFreshGrantAndBoundedReadOnlyMqttSubscription() {
        var p = new SourceProperties(env("SOURCE_GATEWAY_ORIGIN"), env("SOURCE_GATEWAY_SYSTEM"),
                env("SOURCE_TARGET_HOST"), env("SOURCE_TOKEN"), env("SOURCE_USERNAME"), null, null, null,
                null, null, null, env("SOURCE_MQTT_URL"), env("SOURCE_MQTT_USERNAME"), env("SOURCE_MQTT_PASSWORD"),
                env("SOURCE_ALGORITHM_ORIGIN"), 8);
        AccessScope scope = mock(AccessScope.class);
        when(scope.currentUser()).thenReturn(new CurrentUser("test", "test", "test", Role.ADMIN, "test", Set.of(), Set.of()));
        DeviceDirectory directory = new DeviceDirectory(p, new ProviderHttpClient(p), scope); directory.refresh();
        assertFalse(directory.allowedIds().isEmpty());
        TelemetryReceiver telemetry = new TelemetryReceiver(p, directory);
        try { telemetry.synchronizeSubscriptions(); assertEquals(SourceModels.SourceState.HEALTHY, telemetry.health().state()); }
        finally { telemetry.close(); }
    }
    @Test void verifiesActualProviderContractsAndDedicatedReadOnlyPools() {
        SourceProperties p = new SourceProperties(env("SOURCE_GATEWAY_ORIGIN"), env("SOURCE_GATEWAY_SYSTEM"),
                env("SOURCE_TARGET_HOST"), env("SOURCE_TOKEN"), env("SOURCE_USERNAME"), env("SOURCE_DUSHU_JDBC_URL"),
                env("SOURCE_DUSHU_USERNAME"), env("SOURCE_DUSHU_PASSWORD"), env("SOURCE_ICOS_JDBC_URL"),
                env("SOURCE_ICOS_USERNAME"), env("SOURCE_ICOS_PASSWORD"), env("SOURCE_MQTT_URL"),
                env("SOURCE_MQTT_USERNAME"), env("SOURCE_MQTT_PASSWORD"), env("SOURCE_ALGORITHM_ORIGIN"), 8);
        AccessScope scope = mock(AccessScope.class);
        when(scope.currentUser()).thenReturn(new CurrentUser("test", "test", "test", Role.ADMIN, "test", Set.of(), Set.of()));
        ProviderHttpClient http = new ProviderHttpClient(p);
        DeviceDirectory directory = new DeviceDirectory(p, http, scope); directory.refresh();
        Set<String> authorized = directory.allowedIds(); assertFalse(authorized.isEmpty());
        SourceDatabase database = new SourceDatabase(p);
        TelemetryReceiver telemetry = new TelemetryReceiver(p, directory);
        try {
            database.probe();
            assertTrue(database.health().stream().allMatch(item -> item.state() == SourceModels.SourceState.HEALTHY));
            var totals = database.totals(authorized);
            var flights = database.flights(authorized, null, 1, 20);
            var executions = database.executions(authorized, null, 1, 20);
            assertTrue(flights.items().stream().allMatch(item -> authorized.contains(item.deviceId())));
            assertTrue(executions.items().stream().allMatch(item -> authorized.containsAll(item.deviceIds())));
            assertTrue(flights.items().stream().allMatch(item -> item.takeoffAt() == null && item.landingAt() == null));
            AlgorithmCatalog algorithms = new AlgorithmCatalog(http, directory, scope);
            var list = algorithms.list(null, null, null, "all", 1, 100);
            var stats = algorithms.statistics(null, null, null);
            assertEquals(stats.all(), list.total()); assertFalse(algorithms.categories(null).isEmpty());
            var deployed = list.items().stream().filter(item -> Boolean.TRUE.equals(item.deployed())).findFirst();
            if (deployed.isPresent()) {
                var devices = algorithms.deployments(deployed.get().id(), 1, 20);
                assertTrue(devices.items().stream().allMatch(item -> authorized.contains(item.deviceId())));
            }
            telemetry.synchronizeSubscriptions();
            assertEquals(SourceModels.SourceState.HEALTHY, telemetry.health().state());
            System.out.printf("Read-only source contracts verified: authorizedDevices=%d knownTotals=%d flights=%d nativeExecutions=%d algorithms=%d MQTT=%s%n", authorized.size(), totals.size(), flights.total(), executions.total(), list.total(), telemetry.health().state());
        } finally { telemetry.close(); database.close(); }
    }
}
