package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

final class SourceFlightPhotoParser {
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Asia/Shanghai");
    private static final List<DateTimeFormatter> LOCAL_FORMATS = List.of(
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss", Locale.ROOT),
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS", Locale.ROOT));

    private SourceFlightPhotoParser() {}

    static List<SourceFlightPhoto> parse(JsonNode response) {
        if (response == null || !response.path("success").asBoolean(false)) {
            throw ProviderJson.failure("牍术照片目录查询失败");
        }
        JsonNode data = response.get("data");
        if (data == null || !data.isArray()) {
            throw ProviderJson.failure("牍术照片目录格式无效");
        }
        List<SourceFlightPhoto> photos = new ArrayList<>();
        collect(data, photos);
        return List.copyOf(photos);
    }

    private static void collect(JsonNode node, List<SourceFlightPhoto> photos) {
        if (node.isArray()) {
            node.forEach(item -> collect(item, photos));
            return;
        }
        if (!node.isObject()) return;
        if (node.has("id") && node.has("url")) {
            SourceFlightPhoto photo = photo(node);
            if (photo != null) photos.add(photo);
            return;
        }
        node.elements().forEachRemaining(item -> collect(item, photos));
    }

    private static SourceFlightPhoto photo(JsonNode node) {
        String mediaType = text(node, "type");
        String sourceId = text(node, "sourceId");
        if (!"PICTURE".equalsIgnoreCase(mediaType)
                && !"PHOTOGRAPH".equalsIgnoreCase(sourceId)) return null;
        String mediaId = text(node, "id");
        String deviceId = text(node, "deviceId");
        String actionId = text(node, "actionId");
        String actionItemId = text(node, "actionItemId");
        String bid = text(node, "bid");
        String path = safeSourcePath(text(node, "url"));
        if (blank(mediaId) || blank(deviceId) || mediaId.length() > 180 || deviceId.length() > 180
                || tooLong(sourceId, 80)
                || tooLong(actionId) || tooLong(actionItemId) || tooLong(bid) || path == null) return null;
        return new SourceFlightPhoto(
                mediaId,
                sourceId,
                text(node, "sourceName"),
                deviceId,
                actionId,
                actionItemId,
                bid,
                mediaType,
                text(node, "photoType"),
                time(node.get("startTime")),
                time(node.get("endTime")),
                number(node.get("longitude")),
                number(node.get("latitude")),
                number(node.get("height")),
                path);
    }

    static String safeSourcePath(String rawPath) {
        if (blank(rawPath) || rawPath.length() > 2_048 || rawPath.indexOf('\\') >= 0
                || rawPath.indexOf('%') >= 0) return null;
        try {
            URI uri = URI.create(rawPath);
            String path = uri.getRawPath();
            if (uri.isAbsolute()
                    || uri.getRawAuthority() != null
                    || uri.getRawQuery() != null
                    || uri.getRawFragment() != null
                    || path == null
                    || !path.startsWith("/ja-media-storage/")
                    || path.contains("//")) return null;
            for (String segment : path.split("/")) {
                if (".".equals(segment) || "..".equals(segment)) return null;
            }
            return path;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static Instant time(JsonNode value) {
        if (value == null || value.isNull()) return null;
        String text = value.asText();
        try {
            if (text.matches("[0-9]{10,13}")) {
                long epoch = Long.parseLong(text);
                return epoch > 100_000_000_000L
                        ? Instant.ofEpochMilli(epoch)
                        : Instant.ofEpochSecond(epoch);
            }
            try {
                return Instant.parse(text);
            } catch (Exception ignored) {
                // Source timestamps without an offset use the established business zone.
            }
            for (DateTimeFormatter formatter : LOCAL_FORMATS) {
                try {
                    return LocalDateTime.parse(text, formatter).atZone(BUSINESS_ZONE).toInstant();
                } catch (Exception ignored) {
                    // Try the next known source timestamp format.
                }
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(JsonNode node, String key) {
        JsonNode value = node.get(key);
        if (value == null || value.isNull() || !value.isValueNode()) return null;
        return value.asText();
    }

    private static Double number(JsonNode value) {
        if (value == null || value.isNull()) return null;
        try {
            double result = value.isNumber() ? value.doubleValue() : Double.parseDouble(value.asText());
            return Double.isFinite(result) ? result : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }

    private static boolean tooLong(String value) {
        return value != null && value.length() > 180;
    }

    private static boolean tooLong(String value, int maximum) {
        return value != null && value.length() > maximum;
    }
}
