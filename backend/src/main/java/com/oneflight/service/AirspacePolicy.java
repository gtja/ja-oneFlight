package com.oneflight.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.DecimalNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.oneflight.common.ApiException;
import com.oneflight.web.AirspaceImportDtos.AirspaceProfile;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LinearRing;
import org.locationtech.jts.operation.valid.IsValidOp;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/** Shared local-airspace validation. Original coordinate arrays are never rebuilt by JTS. */
@Component
public class AirspacePolicy {
    public static final int MAX_RESOURCE_BYTES = 1024 * 1024;
    public static final int MAX_POLYGON_POINTS = 2000;
    private static final ObjectMapper JSON = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private static final GeometryFactory GEOMETRIES = new GeometryFactory();
    private static final Set<String> PROFILE_FIELDS = Set.of("reference", "lowerHeightMeters", "upperHeightMeters");

    public AirspaceProfile profile(JsonNode value) {
        if (value == null || value.isNull()) return null;
        if (!value.isObject()) throw ApiException.invalid("空域高度设置须为对象");
        value.fieldNames().forEachRemaining(name -> {
            if (!PROFILE_FIELDS.contains(name)) throw ApiException.invalid("未知空域高度字段：" + name);
        });
        JsonNode referenceValue = value.get("reference");
        String reference = referenceValue == null || referenceValue.isNull() ? null : referenceValue.asText();
        if (referenceValue != null && !referenceValue.isNull()
                && (!referenceValue.isTextual() || !Set.of("AGL", "AMSL").contains(reference)))
            throw ApiException.invalid("高度基准请选择离地高度（AGL）或海拔高度（AMSL）");
        Double lower = height(value.get("lowerHeightMeters"));
        Double upper = height(value.get("upperHeightMeters"));
        if ((lower != null || upper != null) && reference == null)
            throw ApiException.invalid("填写空域高度时必须选择离地或海拔基准");
        if ("AGL".equals(reference) && ((lower != null && lower < 0) || (upper != null && upper < 0)))
            throw ApiException.invalid("离地高度不能为负数");
        if (lower != null && upper != null && lower > upper)
            throw ApiException.invalid("高度下限不能高于上限");
        return reference == null && lower == null && upper == null ? null : new AirspaceProfile(reference, lower, upper);
    }

    private Double height(JsonNode value) {
        if (value == null || value.isNull()) return null;
        if (!value.isNumber() || !Double.isFinite(value.doubleValue()))
            throw ApiException.invalid("空域高度必须为有限数值或留空");
        return value.doubleValue();
    }

    public boolean complete(AirspaceProfile profile) {
        return profile != null && profile.reference() != null
                && profile.lowerHeightMeters() != null && profile.upperHeightMeters() != null;
    }

    public int geometry(JsonNode value) {
        if (value == null || !value.isObject() || !"Polygon".equals(value.path("type").asText()))
            throw ApiException.invalid("空域范围须为 GeoJSON Polygon");
        JsonNode rings = value.get("coordinates");
        if (rings == null || !rings.isArray() || rings.isEmpty())
            throw ApiException.invalid("空域范围须包含外环");
        List<LinearRing> parsed = new ArrayList<>();
        int count = 0;
        for (JsonNode ring : rings) {
            if (!ring.isArray() || ring.size() < 4) throw ApiException.invalid("每个边界环至少包含三个点及闭合点");
            count += ring.size();
            if (count > MAX_POLYGON_POINTS) throw ApiException.invalid("单个空域最多2000个坐标点（含内环和闭合点）");
            List<Coordinate> coordinates = new ArrayList<>();
            Set<String> distinct = new TreeSet<>();
            for (JsonNode position : ring) {
                if (!position.isArray() || position.size() < 2)
                    throw ApiException.invalid("边界点须包含经纬度");
                for (JsonNode ordinate : position)
                    if (!ordinate.isNumber() || !Double.isFinite(ordinate.doubleValue()))
                        throw ApiException.invalid("坐标及额外维度必须为有限数值");
                double x = position.get(0).doubleValue();
                double y = position.get(1).doubleValue();
                if (Math.abs(x) > 180 || Math.abs(y) > 90) throw ApiException.invalid("经纬度超出 WGS84 范围");
                coordinates.add(new Coordinate(x, y));
                distinct.add(x + ":" + y);
            }
            if (!coordinates.getFirst().equals2D(coordinates.getLast()))
                throw ApiException.invalid("边界环必须首尾闭合");
            JsonNode first = ring.get(0);
            JsonNode last = ring.get(ring.size() - 1);
            if (first.size() != last.size()) throw ApiException.invalid("闭合点须保留首点全部坐标维度");
            for (int dimension = 0; dimension < first.size(); dimension++)
                if (first.get(dimension).decimalValue().compareTo(last.get(dimension).decimalValue()) != 0)
                    throw ApiException.invalid("边界环首尾全部坐标维度必须一致");
            if (distinct.size() < 3) throw ApiException.invalid("每个边界环至少需要三个不同边界点");
            parsed.add(GEOMETRIES.createLinearRing(coordinates.toArray(Coordinate[]::new)));
        }
        var polygon = GEOMETRIES.createPolygon(parsed.getFirst(), parsed.subList(1, parsed.size()).toArray(LinearRing[]::new));
        var validity = new IsValidOp(polygon);
        if (!validity.isValid() || polygon.getArea() == 0)
            throw ApiException.invalid("空域边界存在自交、无效内环或退化范围，请修正后重试");
        return count;
    }

    /** Older archives may have unspecified/unsupported geometry; only changed geometry is revalidated. */
    public void resource(boolean creating, String previousMetadata, Map<String, Object> metadata) {
        JsonNode next = JSON.valueToTree(metadata == null ? Map.of() : metadata);
        JsonNode previous = read(previousMetadata);
        // Compare numeric values, not Jackson's DecimalNode/DoubleNode implementation types.
        if (creating || !fingerprint(next.path("geometry")).equals(fingerprint(previous.path("geometry"))))
            geometry(next.get("geometry"));
        profile(next.get("airspaceProfile"));
        if (bytes(next) > MAX_RESOURCE_BYTES) throw ApiException.invalid("单个空域扩展数据不得超过1MiB");
    }

    /** A browser must not round source coordinates merely by saving a name or an independent height. */
    public Map<String, Object> preserveGeometry(String previousMetadata, Map<String, Object> metadata) {
        if (metadata == null || !metadata.containsKey("geometry")) return metadata;
        JsonNode previous = read(previousMetadata).get("geometry");
        JsonNode next = tree(metadata.get("geometry"));
        if (previous == null || previous.isNull() || next == null || !next.isObject()) return metadata;
        Map<String, Object> result = new LinkedHashMap<>(metadata);
        result.put("geometry", geometryView(restoreBrowserNumbers(previous, next)));
        return result;
    }

    private JsonNode restoreBrowserNumbers(JsonNode previous, JsonNode next) {
        if (previous.isNumber() && next.isNumber()) {
            double oldNumber = previous.doubleValue();
            double newNumber = next.doubleValue();
            return Double.isFinite(oldNumber) && Double.isFinite(newNumber) && oldNumber == newNumber
                    ? previous.deepCopy() : next.deepCopy();
        }
        if (previous.isObject() && next.isObject()) {
            ObjectNode result = next.deepCopy();
            next.fieldNames().forEachRemaining(key -> {
                if (previous.has(key)) result.set(key, restoreBrowserNumbers(previous.get(key), next.get(key)));
            });
            return result;
        }
        if (previous.isArray() && next.isArray() && previous.size() == next.size()) {
            ArrayNode result = JSON.createArrayNode();
            for (int index = 0; index < next.size(); index++)
                result.add(restoreBrowserNumbers(previous.get(index), next.get(index)));
            return result;
        }
        // A changed collection has no stable point identities; keep the incoming structure and values.
        return next.deepCopy();
    }

    public int bytes(JsonNode value) {
        return json(value).getBytes(StandardCharsets.UTF_8).length;
    }

    public JsonNode read(String value) {
        if (value == null || value.isBlank()) return JSON.createObjectNode();
        try { return JSON.readTree(value); }
        catch (JsonProcessingException e) { return JSON.createObjectNode(); }
    }

    public String json(Object value) {
        try { return JSON.writeValueAsString(value); }
        catch (JsonProcessingException e) { throw ApiException.invalid("空域数据格式不正确"); }
    }

    public JsonNode tree(Object value) { return JSON.valueToTree(value); }

    /** Jackson 2 tree nodes must not cross the application's Jackson 3 HTTP boundary. */
    public Map<String, Object> geometryView(JsonNode value) {
        return value == null || value.isNull() ? null : JSON.convertValue(value, new TypeReference<Map<String, Object>>() {});
    }

    public String fingerprint(JsonNode value) { return hash(json(canonical(value)).getBytes(StandardCharsets.UTF_8)); }

    public String hash(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 is unavailable", e); }
    }

    private JsonNode canonical(JsonNode value) {
        if (value.isObject()) {
            ObjectNode sorted = JSON.createObjectNode();
            Set<String> keys = new TreeSet<>();
            value.fieldNames().forEachRemaining(keys::add);
            keys.forEach(key -> sorted.set(key, canonical(value.get(key))));
            return sorted;
        }
        if (value.isArray()) {
            ArrayNode result = JSON.createArrayNode();
            value.forEach(item -> result.add(canonical(item)));
            return result;
        }
        if (value.isNumber()) return DecimalNode.valueOf(value.decimalValue().stripTrailingZeros());
        return value;
    }
}
