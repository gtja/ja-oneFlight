package com.oneflight.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.common.ApiException;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AirspacePolicyTest {
    private final AirspacePolicy policy = new AirspacePolicy();
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void heightReferenceIsExplicitAndMissingHeightRemainsUnknown() throws Exception {
        assertThat(policy.profile(null)).isNull();
        assertThat(policy.profile(json.readTree("{}"))).isNull();
        var seaLevel = policy.profile(json.readTree("{\"reference\":\"AMSL\",\"lowerHeightMeters\":-430.5,\"upperHeightMeters\":0}"));
        assertThat(seaLevel.lowerHeightMeters()).isEqualTo(-430.5);
        assertThat(seaLevel.upperHeightMeters()).isZero();
        assertThat(policy.profile(json.readTree("{\"reference\":\"AGL\",\"upperHeightMeters\":18000}"))
                .upperHeightMeters()).isEqualTo(18000);
        assertThat(policy.complete(seaLevel)).isTrue();
        assertThat(policy.complete(policy.profile(json.readTree("{\"reference\":\"AGL\"}")))).isFalse();
        for (String invalid : new String[] {
                "{\"lowerHeightMeters\":0}", "{\"reference\":\"AGL\",\"lowerHeightMeters\":-1}",
                "{\"reference\":\"AMSL\",\"lowerHeightMeters\":100,\"upperHeightMeters\":99}",
                "{\"reference\":\"ELLIPSOID\"}", "{\"reference\":\"AGL\",\"upperHeightMeters\":\"100\"}",
                "{\"reference\":\"AGL\",\"upperHeightMeters\":1e999}", "{\"other\":1}"}) {
            JsonNode input = json.readTree(invalid);
            assertThatThrownBy(() -> policy.profile(input)).isInstanceOf(ApiException.class);
        }
    }

    @Test
    void topologyChecksOnlyXYAndRetainsSourceDimensionsAndHoles() throws Exception {
        JsonNode polygon = json.readTree("{\"type\":\"Polygon\",\"coordinates\":[[[120,30,40,7],[122,30,50,8],[122,32,60,9],[120,32,70,10],[120,30,40,7]],[[120.2,30.2,88],[120.4,30.2,88],[120.4,30.4,88],[120.2,30.4,88],[120.2,30.2,88]]]}");
        JsonNode before = polygon.deepCopy();
        assertThat(policy.geometry(polygon)).isEqualTo(10);
        assertThat(polygon).isEqualTo(before);
        for (String invalid : new String[] {
                "{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[1,0],[2,0],[0,0]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[1,0],[1,1],[0,1]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[0,0,10],[1,0,10],[1,1,10],[0,0,11]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[0,0,10,4],[1,0,10],[1,1,10],[0,0,10]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[181,0],[1,0],[1,1],[181,0]]]}",
                "{\"type\":\"Polygon\",\"coordinates\":[[[0,0],[1,0],[1,1],[0,0]],[[5,5],[6,5],[6,6],[5,5]]]}",
                "{\"type\":\"MultiPolygon\",\"coordinates\":[]}"}) {
            JsonNode input = json.readTree(invalid);
            assertThatThrownBy(() -> policy.geometry(input)).isInstanceOf(ApiException.class);
        }
    }

    @Test
    void unchangedLegacyGeometryIsNotReinterpretedButEditedGeometryIsValidated() {
        Map<String, Object> legacy = Map.of("geometry", Map.of("type", "LineString", "coordinates", new double[][] {{120.5,30.1,88.2},{121.5,31.1,89.2}}),
                "coordinateReference", "SOURCE_MAP_UNSPECIFIED");
        policy.resource(false, policy.json(legacy), policy.preserveGeometry(policy.json(legacy), legacy));
        policy.resource(false, null, Map.of());
        assertThatThrownBy(() -> policy.resource(true, null, legacy)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> policy.resource(false, policy.json(legacy), Map.of())).isInstanceOf(ApiException.class);
    }

    @Test
    void browserNumberRestorationKeepsLegacyGeometryAndDoesNotTouchHeightsOrChangedStructure() throws Exception {
        String stored = "{\"geometry\":{\"type\":\"LineString\",\"coordinates\":[[120.123456789012345678901,30,88.123456789012345678901],[121,31,99]]}}";
        Map<String, Object> rounded = new ObjectMapper().readValue(stored,
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        rounded.put("airspaceProfile", Map.of("reference", "AMSL", "upperHeightMeters", 10.123456789012346));
        Map<String, Object> restored = policy.preserveGeometry(stored, rounded);
        policy.resource(false, stored, restored);
        assertThat(policy.json(restored)).contains("120.123456789012345678901", "88.123456789012345678901");
        assertThat(restored.get("airspaceProfile")).isSameAs(rounded.get("airspaceProfile"));
        Map<String, Object> changed = Map.of("geometry", Map.of("type", "Polygon", "coordinates", new int[][][] {{{120,30},{121,30},{121,31},{120,30}}}));
        Map<String, Object> newShape = policy.preserveGeometry(stored, changed);
        policy.resource(false, stored, newShape);
        assertThat(policy.tree(newShape).path("geometry").path("type").asText()).isEqualTo("Polygon");
        Map<String, Object> invalid = policy.preserveGeometry(stored, Map.of("geometry", "invalid"));
        assertThatThrownBy(() -> policy.resource(false, stored, invalid)).isInstanceOf(ApiException.class);
    }

    @Test
    void resourceSizeUsesSerializedUtf8BytesRatherThanCharacters() throws Exception {
        JsonNode geometry = json.readTree("{\"type\":\"Polygon\",\"coordinates\":[[[120,30],[121,30],[121,31],[120,30]]]}");
        Map<String, Object> metadata = Map.of("geometry", geometry, "note", "汉".repeat(350_000));
        assertThatThrownBy(() -> policy.resource(true, null, metadata)).isInstanceOf(ApiException.class)
                .hasMessageContaining("1MiB");
    }
}
