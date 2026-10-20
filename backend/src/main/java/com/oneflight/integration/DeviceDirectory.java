package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneflight.auth.AccessScope;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import static com.oneflight.integration.SourceModels.*;

@Service
public class DeviceDirectory {
    private final SourceProperties properties;
    private final ProviderHttpClient http;
    private final AccessScope scope;
    private volatile Map<String, Device> devices = Map.of();
    private volatile SourceHealth health = new SourceHealth("设备授权目录", SourceState.UNCONFIGURED, null, null, "来源账号未配置");
    public DeviceDirectory(SourceProperties properties, ProviderHttpClient http, AccessScope scope) {
        this.properties = properties; this.http = http; this.scope = scope;
        if (properties.gatewayConfigured()) { health = new SourceHealth("设备授权目录", SourceState.STALE, null, null, "来源账号已配置，待验证"); }
    }
    @Scheduled(initialDelay = 1500, fixedDelay = 60_000)
    public synchronized void refresh() {
        Instant now = Instant.now();
        if (!properties.gatewayConfigured()) {
            devices = Map.of(); health = new SourceHealth("设备授权目录", SourceState.UNCONFIGURED, now, null, "来源账号未配置"); return;
        }
        try {
            JsonNode data = http.gateway("/device/list/tree/v4", Map.of());
            Map<String, Device> found = new LinkedHashMap<>();
            collect(data, null, found);
            if (!data.has("roots") && !data.isArray()) { throw ProviderJson.failure("设备授权目录字段缺失"); }
            devices = Map.copyOf(found);
            health = new SourceHealth("设备授权目录", SourceState.HEALTHY, now, now, "授权目录读取成功");
        } catch (Exception e) {
            // A failed grant refresh invalidates every previous source record immediately.
            devices = Map.of();
            health = new SourceHealth("设备授权目录", SourceState.ERROR, now, health.lastSuccessAt(), "来源授权校验失败，请检查令牌和连接");
        }
    }
    static void collect(JsonNode node, String parentId, Map<String, Device> target) {
        if (node == null || node.isNull()) { return; }
        if (node.isArray()) { for (JsonNode item : node) { collect(item, parentId, target); } return; }
        if (!node.isObject()) { return; }
        String id = ProviderJson.text(node, "deviceId");
        String nextParent = parentId;
        if (id != null && ProviderJson.validTopicPart(id)) {
            target.put(id, new Device(id, ProviderJson.text(node, "productKey"),
                    ProviderJson.text(node, "deviceName", "name"), ProviderJson.text(node, "deviceType", "type"),
                    ProviderJson.text(node, "sn"), ProviderJson.text(node, "orgCode"), parentId,
                    ProviderJson.number(node, "longitude"), ProviderJson.number(node, "latitude"),
                    "UNKNOWN", null, null));
            nextParent = id;
        }
        for (String key : List.of("roots", "devices", "children", "childrenDevices")) {
            collect(node.get(key), nextParent, target);
        }
    }
    public SourceHealth health() {
        SourceHealth current = health;
        if (current.state() == SourceState.HEALTHY && current.lastSuccessAt() != null
                && current.lastSuccessAt().isBefore(Instant.now().minusSeconds(90))) {
            return new SourceHealth(current.name(), SourceState.STALE, current.checkedAt(), current.lastSuccessAt(), "来源授权核验已过期");
        }
        return current;
    }
    public Map<String, Device> authorized() {
        SourceHealth current = health();
        if (current.state() != SourceState.HEALTHY || current.lastSuccessAt() == null
                || current.lastSuccessAt().isBefore(Instant.now().minusSeconds(90))) {
            throw ProviderJson.failure(current.message());
        }
        return devices;
    }
    public Set<String> allowedIds() {
        Set<String> sourceIds = new LinkedHashSet<>(authorized().keySet());
        if (scope.currentUser().role() != Role.ADMIN) { sourceIds.retainAll(scope.allowedDeviceIds()); }
        return sourceIds;
    }
    public Device require(String id) {
        if (!allowedIds().contains(id)) { throw ApiException.forbidden(); }
        return authorized().get(id);
    }
    public Device detail(String id, TelemetryReceiver telemetry, SourceDatabase database) {
        Device device = require(id);
        FlightTotals totals = database.totals(Set.of(id)).get(id);
        // Native aircraft and airport identities remain separate; only this device's own counter is read.
        Device result = observed(device, telemetry.current(id), totals);
        require(id);
        return result;
    }
    public PageResult<Device> list(String keyword, String type, Boolean hasFlightTotals, int page, int size, TelemetryReceiver telemetry,
            SourceDatabase database) {
        Set<String> permitted = allowedIds();
        List<Device> list = new ArrayList<>();
        Map<String, FlightTotals> totals = database.totals(permitted);
        for (Device device : authorized().values()) {
            if (!permitted.contains(device.id())) { continue; }
            String searchable = java.util.Objects.toString(device.name(), "") + " " + device.id() + " "
                    + java.util.Objects.toString(device.sn(), "");
            if (keyword != null && !keyword.isBlank()
                    && !searchable.toLowerCase(java.util.Locale.ROOT).contains(keyword.toLowerCase(java.util.Locale.ROOT))) { continue; }
            if (type != null && !type.isBlank() && !type.equals(device.type())) { continue; }
            if (hasFlightTotals != null && hasFlightTotals != totals.containsKey(device.id())) { continue; }
            list.add(observed(device, telemetry.current(device.id()), totals.get(device.id())));
        }
        list.sort(java.util.Comparator.comparing(Device::id));
        // Re-check grants after an external read so revoked records cannot escape.
        Set<String> permittedAfterRead = allowedIds();
        list.removeIf(device -> !permittedAfterRead.contains(device.id()));
        return PageResult.of(list, page, size);
    }
    private static Device observed(Device device, Telemetry observed, FlightTotals totals) {
        return new Device(device.id(), device.productKey(), device.name(), device.type(), device.sn(),
                device.sourceOrganizationCode(), device.parentDeviceId(),
                observed.longitude() == null ? device.longitude() : observed.longitude(),
                observed.latitude() == null ? device.latitude() : observed.latitude(), observed.status(),
                observed.lastObservedAt(), totals);
    }
}
