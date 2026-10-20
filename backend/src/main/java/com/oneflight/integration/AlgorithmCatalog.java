package com.oneflight.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneflight.auth.AccessScope;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;
import static com.oneflight.integration.SourceModels.*;

@Service
public class AlgorithmCatalog {
    private final ProviderHttpClient http;
    private final DeviceDirectory directory;
    private final AccessScope scope;
    private volatile SourceHealth health = new SourceHealth("算法目录", SourceState.STALE, null, null, "尚未读取算法目录");
    public AlgorithmCatalog(ProviderHttpClient http, DeviceDirectory directory, AccessScope scope) {
        this.http = http; this.directory = directory; this.scope = scope;
    }
    public PageResult<Algorithm> list(String keyword, String category, String deviceType, String deployment, int page, int size) {
        requireReader();
        Map<String, Object> body = filter(keyword, category, deviceType);
        body.put("isPage", true); body.put("page", page); body.put("size", size);
        if ("deployed".equals(deployment)) { body.put("deployed", true); }
        else if ("undeployed".equals(deployment)) { body.put("deployed", false); }
        else if (deployment != null && !deployment.equals("all")) { throw ApiException.invalid("部署筛选值无效"); }
        JsonNode data = read("/algorithm/app/list", body);
        validatePage(data);
        List<Algorithm> items = new ArrayList<>();
        for (JsonNode row : data.path("rows")) { items.add(mapAlgorithm(row)); }
        return new PageResult<>(items, data.path("total").asLong(), page, size);
    }
    public AlgorithmStatistics statistics(String keyword, String category, String deviceType) {
        requireReader();
        JsonNode data = read("/algorithm/app/statistics", filter(keyword, category, deviceType));
        return new AlgorithmStatistics(ProviderJson.integer(data, "totalCount"), ProviderJson.integer(data, "deployedCount"),
                ProviderJson.integer(data, "undeployedCount"), Instant.now());
    }
    public List<AlgorithmCategory> categories(String deviceType) {
        requireReader();
        String path = "/algorithm/app/tag/statistics?tagKey=algo_type";
        if (deviceType != null && !deviceType.isBlank()) { path += "&deviceType=" + URLEncoder.encode(deviceType, StandardCharsets.UTF_8); }
        JsonNode data = read(path, null);
        if (!data.isArray()) { throw ProviderJson.failure("算法分类来源格式错误"); }
        List<AlgorithmCategory> result = new ArrayList<>();
        for (JsonNode row : data) {
            String name = ProviderJson.text(row, "tagValue");
            result.add(new AlgorithmCategory(name, name, ProviderJson.integer(row, "algorithmCount")));
        }
        return result;
    }
    public PageResult<AlgorithmDeployment> deployments(String algorithmId, int page, int size) {
        requireReader();
        if (!algorithmId.matches("[0-9]{1,30}")) { throw ApiException.invalid("算法标识无效"); }
        Set<String> allowedBefore = directory.allowedIds();
        if (allowedBefore.isEmpty()) { return new PageResult<>(List.of(), 0, page, size); }
        List<AlgorithmDeployment> permitted = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        Long expectedTotal = null;
        int readCount = 0;
        for (int sourcePage = 1; sourcePage <= 50; sourcePage++) {
            JsonNode data = read("/algorithm/deploy/device/list", ProviderJson.body("algorithmAppId", algorithmId, "isPage", true, "page", sourcePage, "size", 100));
            validatePage(data);
            long total = data.path("total").asLong();
            if (total > 5000 || (expectedTotal != null && expectedTotal != total)) { throw ProviderJson.failure("算法部署分页来源发生变化或超过读取限制，请重试"); }
            expectedTotal = total;
            JsonNode rows = data.path("rows");
            if (rows.isEmpty() && readCount < total) { throw ProviderJson.failure("算法部署分页不完整，请重试"); }
            for (JsonNode row : rows) {
                String deviceId = ProviderJson.text(row, "deviceId");
                String recordId = ProviderJson.text(row, "deployRecordId");
                if (deviceId == null || !seen.add(deviceId)) { throw ProviderJson.failure("算法部署来源记录缺失标识或分页重复"); }
                readCount++;
                if (allowedBefore.contains(deviceId)) {
                    permitted.add(new AlgorithmDeployment(recordId, deviceId, ProviderJson.text(row, "deviceName", "name"),
                            ProviderJson.text(row, "productKey"), ProviderJson.text(row, "deployStatusName", "deployStatus"), null));
                }
            }
            if (readCount == total) { break; }
            if (readCount > total || sourcePage == 50) { throw ProviderJson.failure("算法部署分页范围不完整"); }
        }
        Set<String> allowedAfter = directory.allowedIds();
        permitted.removeIf(item -> !allowedAfter.contains(item.deviceId()));
        return PageResult.of(permitted, page, size);
    }
    static Algorithm mapAlgorithm(JsonNode row) {
        String id = ProviderJson.text(row, "id");
        if (id == null) { throw ProviderJson.failure("算法来源标识缺失"); }
        List<String> categories = new ArrayList<>();
        if (row.path("tags").isArray()) {
            for (JsonNode tag : row.path("tags")) {
                if ("algo_type".equals(ProviderJson.text(tag, "tagKey"))) {
                    String value = ProviderJson.text(tag, "tagValue"); if (value != null) { categories.add(value); }
                }
            }
        }
        List<String> types = new ArrayList<>();
        JsonNode deviceTypes = row.path("deviceTypes");
        if (deviceTypes.isArray()) { for (JsonNode type : deviceTypes) { if (type.isTextual()) { types.add(type.asText()); } } }
        else if (deviceTypes.isTextual() && !deviceTypes.asText().isBlank()) {
            for (String type : deviceTypes.asText().split(",")) { if (!type.isBlank()) { types.add(type.strip()); } }
        }
        Boolean deployed = row.path("deployed").isBoolean() ? row.path("deployed").asBoolean() : null;
        // Algorithm environment variables, credentials, mount paths and private runtime settings are intentionally excluded.
        Map<String, Object> details = ProviderJson.body("cpu", ProviderJson.number(row, "cpu"), "memory", ProviderJson.number(row, "memory"),
                "gpu", ProviderJson.number(row, "gpu"), "replicas", ProviderJson.integer(row, "replicas"),
                "deployedDeviceCount", ProviderJson.integer(row, "deployedDeviceCount"), "applicationType", ProviderJson.text(row, "appType"),
                "createdAt", ProviderJson.text(row, "gmtCreate"), "updatedAt", ProviderJson.text(row, "gmtModified"));
        return new Algorithm(id, ProviderJson.text(row, "appName", "name"), ProviderJson.text(row, "appDesc", "description"),
                deployed, categories, types, ProviderJson.text(row, "modelShowName"), ProviderJson.text(row, "modelVersionSummary"), details);
    }
    private static Map<String, Object> filter(String keyword, String category, String deviceType) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (keyword != null && !keyword.isBlank()) { result.put("keyword", keyword.strip()); }
        if (category != null && !category.isBlank()) { result.put("tagKey", "algo_type"); result.put("tagValue", category); }
        if (deviceType != null && !deviceType.isBlank()) { result.put("deviceType", List.of(deviceType)); }
        return result;
    }
    private JsonNode read(String path, Map<String, Object> body) {
        try {
            JsonNode data = http.algorithm(path, body); Instant now = Instant.now();
            health = new SourceHealth("算法目录", SourceState.HEALTHY, now, now, "算法目录只读查询正常"); return data;
        } catch (Exception e) {
            health = new SourceHealth("算法目录", SourceState.ERROR, Instant.now(), health.lastSuccessAt(), "算法来源连接或读取失败"); throw e;
        }
    }
    private void requireReader() {
        Role role = scope.currentUser().role();
        if (role != Role.ADMIN && role != Role.DISPATCH) { throw ApiException.forbidden(); }
    }
    private static void validatePage(JsonNode data) {
        if (!data.path("rows").isArray() || !data.path("total").canConvertToLong() || data.path("total").asLong() < 0) {
            throw ProviderJson.failure("来源分页格式错误");
        }
    }
    public SourceHealth health() { return health; }
}
