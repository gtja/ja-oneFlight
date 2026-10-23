package com.oneflight.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.common.ApiException;
import com.oneflight.service.AirspacePolicy;
import com.oneflight.web.AirspaceImportDtos.AirspaceProfile;
import com.oneflight.web.AirspaceImportDtos.ImportOptions;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AirspaceFileParserTest {
    private final AirspaceFileParser parser = new AirspaceFileParser(new AirspacePolicy());
    private final ObjectMapper json = new ObjectMapper()
            .enable(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    private final ImportOptions options = new ImportOptions("org", "余杭区", "WGS84", null);
    private final String polygon = "{\"type\":\"Polygon\",\"coordinates\":[[[120,30,8,9],[121,30,8,9],[121,31,8,9],[120,30,8,9]]]}";

    MockMultipartFile file(String value) { return new MockMultipartFile("file", "空域.geojson", "application/geo+json", value.getBytes(StandardCharsets.UTF_8)); }

    @Test
    void polygonWithoutHeightCanBeConfirmedLaterAndCoordinatesAreNotAltered() throws Exception {
        var parsed = parser.parse(file(polygon), options);
        assertThat(parsed.summary().invalid()).isZero();
        assertThat(parsed.entries()).singleElement().satisfies(entry -> {
            assertThat(entry.title()).isEqualTo("空域");
            assertThat(entry.geometry()).isEqualTo(json.readTree(polygon));
            assertThat(entry.airspaceProfile()).isNull();
        });
        assertThat(parsed.rows().getFirst().warnings()).anyMatch(issue -> "AIRSPACE_HEIGHT_PENDING".equals(issue.code()));
    }

    @Test
    void featureProfilesOverrideDefaultsIncludingExplicitNullAndIdsStayStrings() throws Exception {
        String value = "{\"type\":\"FeatureCollection\",\"features\":["
                + "{\"type\":\"Feature\",\"id\":\"9223372036854775807\",\"properties\":{\"name\":\"甲\"},\"geometry\":" + polygon + "},"
                + "{\"type\":\"Feature\",\"properties\":{\"name\":\"乙\",\"airspaceProfile\":null},\"geometry\":" + polygon + "}]}";
        var defaults = new ImportOptions("org", "余杭区", "WGS84", new AirspaceProfile("AGL", 0.0, 120.0));
        var parsed = parser.parse(file(value), defaults);
        assertThat(parsed.entries().getFirst().sourceFeatureId()).isEqualTo("9223372036854775807");
        assertThat(parsed.entries().getFirst().airspaceProfile().upperHeightMeters()).isEqualTo(120);
        assertThat(parsed.entries().getLast().airspaceProfile()).isNull();
        var numericId = parser.parse(file(value.replace("\"9223372036854775807\"", "9223372036854775807")), defaults);
        assertThat(numericId.summary().invalid()).isZero();
        assertThat(numericId.entries().getFirst().sourceFeatureId()).isEqualTo("9223372036854775807");
        var aboveLong = parser.parse(file(value.replace("\"9223372036854775807\"", "9223372036854775807123")), defaults);
        assertThat(aboveLong.entries().getFirst().sourceFeatureId()).isEqualTo("9223372036854775807123");
        var decimalId = parser.parse(file(value.replace("\"9223372036854775807\"", "123.5")), defaults);
        assertThat(decimalId.summary().invalid()).isEqualTo(1);
    }

    @Test
    void duplicateFeaturesAreReportedAndInvalidRowsBlockTheWholeBatch() {
        String feature = "{\"type\":\"Feature\",\"properties\":{\"name\":\"同名\"},\"geometry\":" + polygon + "}";
        var duplicate = parser.parse(file("{\"type\":\"FeatureCollection\",\"features\":[" + feature + "," + feature + "]}"), options);
        assertThat(duplicate.summary().duplicates()).isEqualTo(1);
        var invalid = parser.parse(file("{\"type\":\"FeatureCollection\",\"features\":[" + feature + ",{\"type\":\"Feature\",\"geometry\":{\"type\":\"Point\",\"coordinates\":[120,30]}}]}"), options);
        assertThat(invalid.summary().valid()).isEqualTo(1);
        assertThat(invalid.summary().invalid()).isEqualTo(1);
        assertThat(invalid.rows().getLast().geometry()).isNull();
    }

    @Test
    void malformedFormatsCoordinateReferencesAndFileSizesAreRejected() {
        for (String value : List.of("invalid", polygon + "{}", "{\"type\":\"MultiPolygon\",\"coordinates\":[]}",
                "{\"type\":\"FeatureCollection\",\"features\":[]}",
                polygon.replace("\"type\":", "\"crs\":{\"name\":\"GCJ02\"},\"type\":")))
            assertThatThrownBy(() -> parser.parse(file(value), options)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> parser.parse(file(polygon), new ImportOptions("org", "余杭区", "GCJ02", null)))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> parser.parse(new MockMultipartFile("file", "areas.kml", "text/xml", polygon.getBytes(StandardCharsets.UTF_8)), options))
                .isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> parser.parse(new MockMultipartFile("file", "areas.json", "application/json", new byte[AirspaceFileParser.MAX_FILE_BYTES + 1]), options))
                .isInstanceOf(ApiException.class).extracting("code").isEqualTo("AIRSPACE_FILE_TOO_LARGE");
    }

    @Test
    void polygonAndBatchPointLimitsAndFeatureCountAreBounded() throws Exception {
        var ring = new java.util.ArrayList<List<Double>>();
        for (int i = 0; i < 2000; i++) {
            double angle = 2 * Math.PI * i / 2000;
            ring.add(List.of(120 + Math.cos(angle), 30 + Math.sin(angle)));
        }
        ring.add(ring.getFirst());
        String largePolygon = json.writeValueAsString(Map.of("type", "Polygon", "coordinates", List.of(ring)));
        assertThat(parser.parse(file(largePolygon), options).summary().invalid()).isEqualTo(1);
        ring.remove(ring.size() - 2);
        Object geometry = Map.of("type", "Polygon", "coordinates", List.of(ring));
        var features = java.util.stream.IntStream.range(0, 11).mapToObj(i -> Map.of("type", "Feature", "geometry", geometry)).toList();
        var overTotal = parser.parse(file(json.writeValueAsString(Map.of("type", "FeatureCollection", "features", features))), options);
        assertThat(overTotal.summary().pointCount()).isEqualTo(22000);
        assertThat(overTotal.summary().invalid()).isEqualTo(1);
        var tooMany = java.util.Collections.nCopies(101, Map.of("type", "Feature", "geometry", json.readTree(polygon)));
        assertThatThrownBy(() -> parser.parse(file(json.writeValueAsString(Map.of("type", "FeatureCollection", "features", tooMany))), options))
                .isInstanceOf(ApiException.class);
    }
}
