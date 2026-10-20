package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import static com.oneflight.integration.SourceModels.*;

/** Read-only, exact-topic receiver; this class has no publishing operation. */
@Component
public class TelemetryReceiver {
    private final SourceProperties properties;
    private final DeviceDirectory directory;
    private final Map<String, Telemetry> observations = new ConcurrentHashMap<>();
    private volatile Map<String, String> topicDevices = Map.of();
    private volatile MqttClient client;
    private volatile SourceHealth health = new SourceHealth("实时遥测", SourceState.UNCONFIGURED, null, null, "MQTT未配置");
    public TelemetryReceiver(SourceProperties properties, DeviceDirectory directory) {
        this.properties = properties; this.directory = directory;
        if (properties.mqttConfigured()) { health = new SourceHealth("实时遥测", SourceState.STALE, null, null, "实时来源已配置，待验证"); }
    }
    @Scheduled(initialDelay = 3500, fixedDelay = 15_000)
    public synchronized void synchronizeSubscriptions() {
        Instant now = Instant.now();
        if (!properties.mqttConfigured()) {
            health = new SourceHealth("实时遥测", SourceState.UNCONFIGURED, now, null, "MQTT未配置"); return;
        }
        try {
            Map<String, Device> devices = directory.authorized();
            Map<String, String> expected = topics(devices);
            observations.keySet().retainAll(devices.keySet());
            if (client == null || !client.isConnected()) {
                close();
                client = new MqttClient(properties.mqttUrl().replace("mqtt://", "tcp://"),
                        "oneflight-" + UUID.randomUUID(), new MemoryPersistence());
                client.setTimeToWait(15_000);
                client.setCallback(new MqttCallback() {
                    @Override public void connectionLost(Throwable cause) {
                        health = new SourceHealth("实时遥测", SourceState.ERROR, Instant.now(), health.lastSuccessAt(), "实时连接中断，设备状态未知");
                    }
                    @Override public void messageArrived(String topic, MqttMessage message) {
                        accept(topic, message.getPayload(), Instant.now(), message.isRetained());
                    }
                    @Override public void deliveryComplete(IMqttDeliveryToken token) { }
                });
                MqttConnectOptions options = new MqttConnectOptions();
                options.setUserName(properties.mqttUsername());
                options.setPassword(properties.mqttPassword().toCharArray());
                options.setConnectionTimeout(properties.timeoutSeconds());
                options.setKeepAliveInterval(30); options.setCleanSession(true); options.setAutomaticReconnect(false);
                client.connect(options);
                topicDevices = Map.of();
            }
            List<String> revoked = topicDevices.keySet().stream().filter(topic -> !expected.containsKey(topic)).toList();
            if (!revoked.isEmpty()) { client.unsubscribe(revoked.toArray(String[]::new)); }
            List<String> added = expected.keySet().stream().filter(topic -> !topicDevices.containsKey(topic)).toList();
            topicDevices = Map.copyOf(expected);
            if (!added.isEmpty()) { client.subscribe(added.toArray(String[]::new)); }
            health = new SourceHealth("实时遥测", SourceState.HEALTHY, now, now, "实时连接正常，状态以最近有效上报为准");
        } catch (Exception e) {
            close(); topicDevices = Map.of();
            health = new SourceHealth("实时遥测", SourceState.ERROR, now, health.lastSuccessAt(), "来源授权或MQTT连接不可用");
        }
    }
    static Map<String, String> topics(Map<String, Device> devices) {
        Map<String, String> result = new LinkedHashMap<>();
        for (Device device : devices.values()) {
            if (ProviderJson.validTopicPart(device.productKey()) && ProviderJson.validTopicPart(device.id())) {
                result.put("sys/" + device.productKey() + "/" + device.id() + "/thing/properties/state", device.id());
                result.put("sys/" + device.productKey() + "/" + device.id() + "/thing/event/property/post", device.id());
            }
            if (ProviderJson.validTopicPart(device.sn())) {
                result.put("thing/product/" + device.sn() + "/osd", device.id());
                result.put("sys/product/" + device.sn() + "/status", device.id());
            }
        }
        return result;
    }
    void accept(String topic, byte[] bytes, Instant receivedAt, boolean retained) {
        String id = topicDevices.get(topic);
        if (id == null || bytes.length > 256 * 1024) { return; }
        try {
            Device sourceDevice = directory.authorized().get(id);
            if (sourceDevice == null) { return; }
            JsonNode root = ProviderJson.JSON.readTree(new String(bytes, StandardCharsets.UTF_8));
            JsonNode payload = root.has("data") ? root.path("data") : root;
            if (payload.has("properties")) { payload = payload.path("properties"); }
            Telemetry parsed = parse(id, payload, root, receivedAt,
                    topic.startsWith("thing/product/") && topic.endsWith("/osd") ? sourceDevice.type() : null);
            if (parsed == null) { return; }
            Telemetry verified = retained && ProviderJson.timestamp(root, "timestamp", "time", "ts") == null
                    && ProviderJson.timestamp(payload, "timestamp", "time", "ts") == null ? parsed.unknown() : parsed;
            observations.compute(id, (key, previous) -> merge(previous, verified));
        } catch (Exception ignored) { /* Invalid message cannot replace the last valid observation. */ }
    }
    static Telemetry parse(String id, JsonNode payload, JsonNode root, Instant receivedAt) {
        return parse(id, payload, root, receivedAt, null);
    }
    static Telemetry parse(String id, JsonNode payload, JsonNode root, Instant receivedAt, String sourceDeviceType) {
        Double longitude = ProviderJson.number(payload, "longitude", "lng");
        Double latitude = ProviderJson.number(payload, "latitude", "lat");
        if (longitude != null && (longitude < -180 || longitude > 180)) { longitude = null; }
        if (latitude != null && (latitude < -90 || latitude > 90)) { latitude = null; }
        if (longitude == null || latitude == null) { longitude = null; latitude = null; }
        Double battery = ProviderJson.number(payload, "remainingPower", "batteryPercent", "capacity_percent");
        if (battery == null && payload.has("battery")) { battery = ProviderJson.number(payload.path("battery"), "capacity_percent"); }
        if (battery != null && (battery < 0 || battery > 100)) { battery = null; }
        String state = ProviderJson.text(payload, "online", "isOnline", "status", "deviceStatus");
        String status = state != null && (state.equalsIgnoreCase("OFFLINE") || state.equals("false")) ? "OFFLINE"
                : state != null && (state.equalsIgnoreCase("ONLINE") || state.equals("true")) ? "ONLINE" : "UNKNOWN";
        Double altitude = ProviderJson.number(payload, "height", "altitude", "altitudeMeters");
        // Dock OSD wind_speed is documented in m/s. Aircraft/raw IoT wind units are not interchangeable.
        Double wind = "UAV_AIRPORT".equals(sourceDeviceType) ? ProviderJson.number(payload, "wind_speed") : null;
        Double temperature = ProviderJson.number(payload, "environment_temperature", "temperature");
        Double humidity = ProviderJson.number(payload, "humidity");
        String task = ProviderJson.text(payload, "taskStatus", "task_status");
        if (longitude == null && latitude == null && battery == null && altitude == null && wind == null
                && temperature == null && humidity == null && task == null && status.equals("UNKNOWN")) { return null; }
        if (status.equals("UNKNOWN")) { status = "ONLINE"; }
        Instant observedAt = ProviderJson.timestamp(root, "timestamp", "time", "ts");
        if (observedAt == null) { observedAt = ProviderJson.timestamp(payload, "timestamp", "time", "ts"); }
        if (observedAt == null) { observedAt = receivedAt; }
        if (observedAt.isAfter(receivedAt.plusSeconds(30))) { return null; }
        return new Telemetry(id, status, observedAt, receivedAt, longitude != null && latitude != null ? observedAt : null, longitude, latitude, altitude, battery,
                wind, temperature, humidity, task);
    }
    static Telemetry merge(Telemetry previous, Telemetry current) {
        if (previous == null) { return current; }
        if (!current.lastObservedAt().isAfter(previous.lastObservedAt())) { return previous; }
        return new Telemetry(current.deviceId(), current.status(), current.lastObservedAt(), current.receivedAt(),
                current.positionObservedAt() == null ? previous.positionObservedAt() : current.positionObservedAt(),
                first(current.longitude(), previous.longitude()), first(current.latitude(), previous.latitude()),
                first(current.altitudeMeters(), previous.altitudeMeters()), first(current.batteryPercent(), previous.batteryPercent()),
                first(current.windSpeed(), previous.windSpeed()), first(current.temperature(), previous.temperature()),
                first(current.humidity(), previous.humidity()), current.taskStatus() == null ? previous.taskStatus() : current.taskStatus());
    }
    private static Double first(Double current, Double previous) { return current == null ? previous : current; }
    public Telemetry current(String id) {
        Telemetry result = observations.get(id);
        if (result == null) { return new Telemetry(id, "UNKNOWN", null, null, null, null, null, null, null, null, null, null, null); }
        if (client == null || !client.isConnected() || result.lastObservedAt().isBefore(Instant.now().minusSeconds(60))) { return result.unknown(); }
        return result;
    }
    public SourceHealth health() { return health; }
    @PreDestroy
    public synchronized void close() {
        if (client != null) {
            try { if (client.isConnected()) { client.disconnect(); } client.close(); }
            catch (Exception ignored) { }
            client = null;
        }
    }
}
