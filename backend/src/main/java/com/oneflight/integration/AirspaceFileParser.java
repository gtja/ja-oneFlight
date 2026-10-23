package com.oneflight.integration;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.oneflight.common.ApiException;
import com.oneflight.service.AirspacePolicy;
import com.oneflight.web.AirspaceImportDtos.AirspaceProfile;
import com.oneflight.web.AirspaceImportDtos.ImportOptions;
import com.oneflight.web.AirspaceImportDtos.Issue;
import com.oneflight.web.AirspaceImportDtos.PreviewRow;
import com.oneflight.web.AirspaceImportDtos.Summary;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Local files only. No upstream calls, URL resolution, coordinate conversion or device writes. */
@Component
public class AirspaceFileParser {
    public static final int MAX_FILE_BYTES = 2 * 1024 * 1024;
    public static final int MAX_FEATURES = 100;
    public static final int MAX_TOTAL_POINTS = 20_000;
    private static final Set<String> MAPPED_PROPERTIES = Set.of("name", "model", "description", "airspaceProfile");
    private final AirspacePolicy policy;
    private final ObjectMapper json = new ObjectMapper(JsonFactory.builder()
            .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(40).build()).build())
            .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    public AirspaceFileParser(AirspacePolicy policy) { this.policy = policy; }

    public record Entry(int index, String title, String model, String description, JsonNode geometry,
            AirspaceProfile airspaceProfile, String sourceFeatureId, String fingerprint) {}
    public record ParsedFile(String filename, String fileHash, List<Entry> entries,
            List<PreviewRow> rows, Summary summary) {}

    public ParsedFile parse(MultipartFile file, ImportOptions options) {
        if (!"WGS84".equals(options.coordinateReference()))
            throw ApiException.invalid("上传前请确认文件为 WGS84 经度、纬度坐标；当前不执行坐标转换");
        AirspaceProfile defaults = policy.profile(policy.tree(options.defaultAirspaceProfile()));
        String filename = filename(file.getOriginalFilename());
        String extension = filename.toLowerCase(Locale.ROOT);
        if (!extension.endsWith(".geojson") && !extension.endsWith(".json"))
            throw ApiException.invalid("仅支持 .geojson 或 .json 文件");
        byte[] bytes;
        try {
            if (file.isEmpty() || file.getSize() > MAX_FILE_BYTES) throw fileSize();
            try (var input = file.getInputStream()) { bytes = input.readNBytes(MAX_FILE_BYTES + 1); }
        } catch (IOException e) { throw ApiException.invalid("空域文件读取失败，请重新选择文件"); }
        if (bytes.length == 0 || bytes.length > MAX_FILE_BYTES) throw fileSize();
        JsonNode root;
        try (var parser = json.createParser(bytes)) {
            root = json.readTree(parser);
            if (root == null || !root.isObject() || parser.nextToken() != null)
                throw ApiException.invalid("文件必须包含一个完整的 GeoJSON 对象");
        } catch (IOException e) { throw ApiException.invalid("文件不是有效的 GeoJSON JSON，请检查内容及嵌套深度"); }
        requireCoordinateReference(root);
        List<JsonNode> features = new ArrayList<>();
        String type = root.path("type").asText();
        if ("FeatureCollection".equals(type)) {
            JsonNode values = root.get("features");
            if (values == null || !values.isArray() || values.isEmpty() || values.size() > MAX_FEATURES)
                throw ApiException.invalid("文件须包含1至100个 Polygon 空域");
            values.forEach(features::add);
        } else if ("Feature".equals(type) || "Polygon".equals(type)) features.add(root);
        else throw ApiException.invalid("仅支持 Polygon、Feature 或 FeatureCollection，不支持拆分 MultiPolygon");
        String stem = filename.substring(0, filename.lastIndexOf('.'));
        if (stem.isBlank()) stem = "空域";
        List<PreviewRow> rows = new ArrayList<>();
        List<Entry> entries = new ArrayList<>();
        Set<String> fingerprints = new HashSet<>();
        int points = 0;
        for (int i = 0; i < features.size(); i++) {
            JsonNode feature = features.get(i);
            List<Issue> errors = new ArrayList<>();
            List<Issue> warnings = new ArrayList<>();
            String title = "Polygon".equals(type) ? stem : stem + "-" + (i + 1);
            String model = null;
            String description = null;
            String sourceId = null;
            JsonNode geometry = null;
            AirspaceProfile profile = defaults;
            int count = 0;
            boolean duplicate = false;
            try {
                requireCoordinateReference(feature);
                if (!feature.isObject()) throw ApiException.invalid("空域条目须为 GeoJSON 对象");
                if ("Polygon".equals(type)) geometry = feature;
                else {
                    if (!"Feature".equals(feature.path("type").asText()))
                        throw ApiException.invalid("FeatureCollection 中每个条目须为 Feature");
                    geometry = feature.get("geometry");
                    JsonNode properties = feature.get("properties");
                    if (properties != null && !properties.isNull()) {
                        if (!properties.isObject()) throw ApiException.invalid("properties 须为对象或 null");
                        String name = text(properties.get("name"), "name", 180);
                        if (name != null) title = name;
                        model = text(properties.get("model"), "model", 180);
                        description = text(properties.get("description"), "description", 8000);
                        if (properties.has("airspaceProfile")) profile = policy.profile(properties.get("airspaceProfile"));
                        boolean unmapped = false;
                        for (var names = properties.fieldNames(); names.hasNext();)
                            if (!MAPPED_PROPERTIES.contains(names.next())) unmapped = true;
                        if (unmapped) warnings.add(new Issue("UNMAPPED_PROPERTIES", "未映射的 properties 字段不会写入业务档案"));
                    }
                    JsonNode rawId = feature.get("id");
                    if (rawId != null && !rawId.isNull()) {
                        if (!rawId.isTextual() && !rawId.isIntegralNumber())
                            throw ApiException.invalid("Feature.id须为字符串或整数");
                        sourceId = rawId.asText();
                        if (sourceId.length() > 180) throw ApiException.invalid("Feature.id长度不得超过180");
                    }
                }
                if (title.length() > 180) throw ApiException.invalid("空域名称不得超过180个字符");
                requireCoordinateReference(geometry);
                count = countPoints(geometry == null ? null : geometry.get("coordinates"));
                policy.geometry(geometry);
                String fingerprint = policy.fingerprint(content(title, model, description, geometry, profile));
                Entry entry = new Entry(i + 1, title, model, description, geometry, profile, sourceId, fingerprint);
                if (policy.bytes(metadata(entry)) > AirspacePolicy.MAX_RESOURCE_BYTES)
                    throw ApiException.invalid("单个空域扩展数据不得超过1MiB");
                duplicate = !fingerprints.add(fingerprint);
                if (duplicate) warnings.add(new Issue("DUPLICATE_IN_FILE", "文件内完全相同的空域只导入一次"));
                if (!policy.complete(profile)) warnings.add(new Issue("AIRSPACE_HEIGHT_PENDING", "高度范围尚未完整设置，允许导入为待确认并后续补齐"));
                entries.add(entry);
            } catch (ApiException e) { errors.add(new Issue(e.getCode(), e.getMessage())); }
            points += count;
            if (points > MAX_TOTAL_POINTS)
                errors.add(new Issue("TOO_MANY_POINTS", "单批次最多20000个坐标点（含内环和闭合点）"));
            rows.add(new PreviewRow(i + 1, title, model, description, errors.isEmpty() ? policy.geometryView(geometry) : null,
                    profile, count, duplicate, List.copyOf(errors), List.copyOf(warnings)));
        }
        int invalid = (int) rows.stream().filter(row -> !row.errors().isEmpty()).count();
        int duplicates = (int) rows.stream().filter(PreviewRow::duplicate).count();
        return new ParsedFile(filename, policy.hash(bytes), List.copyOf(entries), List.copyOf(rows),
                new Summary(rows.size(), rows.size() - invalid, invalid, duplicates, points));
    }

    public ObjectNode content(String title, String model, String description, JsonNode geometry, AirspaceProfile profile) {
        ObjectNode content = json.createObjectNode();
        content.put("title", title);
        content.put("model", model);
        content.put("description", description);
        content.set("geometry", geometry);
        content.set("airspaceProfile", policy.tree(profile));
        return content;
    }

    public ObjectNode metadata(Entry entry) {
        ObjectNode metadata = json.createObjectNode();
        metadata.set("geometry", entry.geometry());
        metadata.set("airspaceProfile", policy.tree(entry.airspaceProfile()));
        metadata.put("coordinateReference", "WGS84");
        metadata.put("description", entry.description());
        return metadata;
    }

    private int countPoints(JsonNode value) {
        if (value == null || !value.isArray()) return 0;
        if (!value.isEmpty() && value.get(0).isNumber()) return 1;
        int count = 0;
        for (JsonNode child : value) count += countPoints(child);
        return count;
    }

    private String text(JsonNode value, String field, int max) {
        if (value == null || value.isNull()) return null;
        if (!value.isTextual()) throw ApiException.invalid(field + "须为字符串");
        String result = value.textValue().trim();
        if (result.length() > max) throw ApiException.invalid(field + "长度不得超过" + max);
        return result.isEmpty() ? null : result;
    }

    private void requireCoordinateReference(JsonNode value) {
        if (value != null && value.hasNonNull("crs"))
            throw ApiException.invalid("文件含 crs 声明，请先导出为不带 crs 字段的标准 WGS84 GeoJSON");
    }

    private ApiException fileSize() {
        return new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "AIRSPACE_FILE_TOO_LARGE", "空域文件大小须为1字节至2MiB");
    }

    private String filename(String original) {
        String name = original == null ? "空域.geojson" : original.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\r\\n]", "");
        return name.length() > 200 ? name.substring(name.length() - 200) : name;
    }
}
