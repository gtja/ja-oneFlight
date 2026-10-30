package com.oneflight.integration;

import java.time.Instant;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public record SourceFlightPhoto(
        String sourceMediaId,
        String sourceId,
        String sourceName,
        String sourceDeviceId,
        String sourceActionId,
        String sourceActionItemId,
        String sourceBid,
        String type,
        String photoType,
        Instant capturedFrom,
        Instant capturedTo,
        Double longitude,
        Double latitude,
        Double sourceHeight,
        String sourcePath) {

    public String title() {
        String value = sourceName == null || sourceName.isBlank()
                ? "牍术飞行照片 " + sourceMediaId
                : sourceName;
        return value.length() > 180 ? value.substring(0, 179) + "…" : value;
    }

    public Map<String, Object> view(
            String taskId,
            String taskTitle,
            String caseId,
            String associationStatus,
            List<Map<String, Object>> taskCandidates) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", "DUSHU:" + sourceDeviceId + ":" + sourceMediaId);
        result.put("sourceMediaId", sourceMediaId);
        result.put("sourceSystem", "DUSHU");
        result.put("sourceCategory", "FLIGHT_PHOTO");
        result.put("title", title());
        result.put("fileName", title());
        result.put("entityType", "SOURCE_MEDIA");
        result.put("contentType", contentType());
        result.put("sourceId", sourceId);
        result.put("sourceName", sourceName);
        result.put("sourceDeviceId", sourceDeviceId);
        result.put("sourceActionId", sourceActionId);
        result.put("sourceActionItemId", sourceActionItemId);
        result.put("sourceBid", sourceBid);
        result.put("type", type);
        result.put("photoType", photoType);
        result.put("capturedFrom", capturedFrom);
        result.put("capturedTo", capturedTo);
        result.put("createdAt", capturedFrom);
        result.put("longitude", longitude);
        result.put("latitude", latitude);
        result.put("sourceHeight", sourceHeight);
        result.put("taskId", taskId);
        result.put("entityTitle", taskTitle);
        result.put("caseId", caseId);
        result.put("associationStatus", associationStatus);
        result.put("taskCandidates", taskCandidates);
        String previewUrl = "/api/v1/source-data/flight-photos/preview?sourceMediaId="
                + encode(sourceMediaId) + "&deviceId=" + encode(sourceDeviceId);
        if (caseId != null && !caseId.isBlank()) previewUrl += "&caseId=" + encode(caseId);
        result.put("previewUrl", previewUrl);
        result.put("qualityStatus", "SOURCE_UNVERIFIED");
        return result;
    }

    private String contentType() {
        String path = sourcePath.toLowerCase(java.util.Locale.ROOT);
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".gif")) return "image/gif";
        return "image/jpeg";
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
