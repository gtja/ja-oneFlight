package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.common.ApiException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;

final class ProviderJson {
    static final ObjectMapper JSON = new ObjectMapper();
    private ProviderJson() { }
    static JsonNode envelope(String response) {
        try {
            JsonNode value = JSON.readTree(response);
            if (value == null || !"SUCCESS".equals(value.path("code").asText())) {
                throw failure("来源服务返回业务错误，请检查来源账号和接入配置");
            }
            if (!value.has("data") || value.get("data").isNull()) {
                throw failure("来源返回缺少数据字段");
            }
            return value.get("data");
        } catch (ApiException e) { throw e; }
        catch (Exception e) { throw failure("来源返回格式错误"); }
    }
    static ApiException failure(String message) {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "SOURCE_UNAVAILABLE", message);
    }
    static String text(JsonNode node, String... keys) {
        for (String key : keys) {
            JsonNode value = node.get(key);
            if (value != null && !value.isNull() && value.isValueNode()) { return value.asText(); }
        }
        return null;
    }
    static Double number(JsonNode node, String... keys) {
        String text = text(node, keys);
        if (text == null) { return null; }
        try { double value = Double.parseDouble(text); return Double.isFinite(value) ? value : null; }
        catch (NumberFormatException e) { return null; }
    }
    static Long integer(JsonNode node, String... keys) {
        String value = text(node, keys);
        try { return value == null ? null : Long.valueOf(value); }
        catch (NumberFormatException e) { return null; }
    }
    static Instant timestamp(JsonNode node, String... keys) {
        String value = text(node, keys);
        if (value == null) { return null; }
        try {
            if (value.matches("[0-9]+")) {
                long epoch = Long.parseLong(value);
                return epoch > 100_000_000_000L ? Instant.ofEpochMilli(epoch) : Instant.ofEpochSecond(epoch);
            }
            return Instant.parse(value);
        } catch (Exception e) { return null; }
    }
    static Map<String, Object> body(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i < values.length; i += 2) {
            if (values[i + 1] != null) { result.put(values[i].toString(), values[i + 1]); }
        }
        return result;
    }
    static boolean validTopicPart(String value) {
        return value != null && !value.isBlank() && value.length() <= 128
                && value.matches("[a-zA-Z0-9_.:-]+");
    }
}
