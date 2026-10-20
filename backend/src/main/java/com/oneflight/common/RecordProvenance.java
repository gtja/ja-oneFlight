package com.oneflight.common;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Server stamped origin information. Source imports bypass ordinary input and set their own origin. */
public final class RecordProvenance {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> INPUT_KEYS = Set.of("origin", "key", "description");

    private RecordProvenance() {}

    public static Map<String, Object> view(String value) {
        if (value == null || value.isBlank()) return Map.of();
        try {
            return JSON.readValue(value, new TypeReference<>() {});
        } catch (Exception e) {
            return Map.of("origin", "UNKNOWN", "description", "来源信息待核对");
        }
    }

    public static String apply(String existing, Map<String, Object> input, CurrentUser user) {
        if (input == null || input.isEmpty()) return existing;
        Map<String, Object> old = view(existing);
        boolean unchanged = input.entrySet().stream()
                .allMatch(entry -> java.util.Objects.equals(old.get(entry.getKey()), entry.getValue()));
        if (unchanged) return existing;
        if (user.role() != Role.ADMIN) throw ApiException.forbidden();
        if (!old.isEmpty()) throw ApiException.invalid("已登记的来源信息不可覆盖");
        if (!INPUT_KEYS.containsAll(input.keySet())
                || !(input.get("origin") instanceof String origin)
                || !Set.of("BUSINESS_INITIALIZATION", "MANUAL").contains(origin)) {
            throw ApiException.invalid("来源信息不正确");
        }
        Map<String, Object> record = new LinkedHashMap<>(input);
        record.put("recordedAt", Instant.now().toString());
        record.put("recordedBy", user.id());
        try {
            String result = JSON.writeValueAsString(record);
            if (result.length() > 8192) throw ApiException.invalid("来源说明过长");
            return result;
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw ApiException.invalid("来源信息格式无效");
        }
    }
}
