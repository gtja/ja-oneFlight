package com.oneflight.integration;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class SourceModels {
    private SourceModels() { }
    public enum SourceState { UNCONFIGURED, HEALTHY, ERROR, STALE }
    public record SourceHealth(String name, SourceState state, Instant checkedAt, Instant lastSuccessAt,
            String message) { }
    public record Device(String id, String productKey, String name, String type, String sn,
            String sourceOrganizationCode, String parentDeviceId, Double longitude, Double latitude,
            String status, Instant lastObservedAt, FlightTotals flightTotals) { }
    public record FlightTotals(Long sorties, Long timeSeconds, Double distanceMeters, Instant reportedAt) { }
    public record Telemetry(String deviceId, String status, Instant lastObservedAt, Instant receivedAt,
            Instant positionObservedAt, Double longitude, Double latitude, Double altitudeMeters, Double batteryPercent,
            Double windSpeed, Double temperature, Double humidity, String taskStatus) {
        public Telemetry unknown() {
            return new Telemetry(deviceId, "UNKNOWN", lastObservedAt, receivedAt, positionObservedAt, longitude, latitude,
                    altitudeMeters, batteryPercent, windSpeed, temperature, humidity, taskStatus);
        }
    }
    public record Capabilities(String deviceId, Map<String, Boolean> capabilities, String message) { }
    public record Flight(String id, String deviceId, String productKey, String sortieNo,
            Long flightTimeSeconds, Double flightDistanceMeters, Instant reportedAt, Instant updatedAt,
            String settlement, Instant takeoffAt, Instant landingAt) { }
    public record Execution(String id, String nativeActionId, String nativeActionRecordId,
            String nativeActionItemId, String nativeTaskRecordId, String nativeTaskId, String name,
            List<String> deviceIds, String status, String nativeItemCurrentStatus, Instant executionStartAt, Instant executionEndAt,
            Instant reportedAt, String provider) { }
    public record Algorithm(String id, String name, String description, Boolean deployed,
            List<String> categories, List<String> deviceTypes, String modelName, String version,
            Map<String, Object> details) { }
    public record AlgorithmStatistics(Long all, Long deployed, Long undeployed, Instant readAt) { }
    public record AlgorithmCategory(String key, String name, Long count) { }
    public record AlgorithmDeployment(String id, String deviceId, String deviceName,
            String productKey, String status, String version) { }
}
