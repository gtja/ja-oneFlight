package com.oneflight;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.domain.AirspaceImportBatch;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.AirspaceImportBatchRepository;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.UserAccountRepository;
import com.oneflight.service.AirspaceImportService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AirspaceImportIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired AirspaceImportBatchRepository batches;
    @Autowired ResourceRepository resources;
    @Autowired OrganizationRepository organizations;
    @Autowired UserAccountRepository users;
    @Autowired AuditEventRepository audits;
    @Autowired AirspaceImportService service;
    final ObjectMapper json = new ObjectMapper()
            .enable(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
    Organization organization;
    UserAccount admin;
    UserAccount dispatcher;
    final String polygon = "{\"type\":\"Polygon\",\"coordinates\":[[[120,30,40,7],[122,30,50,8],[122,32,60,9],[120,32,70,10],[120,30,40,7]],[[120.2,30.2,88],[120.4,30.2,88],[120.4,30.4,88],[120.2,30.4,88],[120.2,30.2,88]]]}";

    @BeforeEach
    void setup() {
        organization = new Organization();
        organization.title = "空域导入测试";
        organization.status = "ACTIVE";
        organization.organizationId = organization.id;
        organization.region = "杭州市";
        organization = organizations.save(organization);
        admin = account(Role.ADMIN);
        dispatcher = account(Role.DISPATCH);
    }

    UserAccount account(Role role) {
        UserAccount account = new UserAccount();
        account.username = "airspace-" + UUID.randomUUID();
        account.displayName = account.username;
        account.passwordHash = "{noop}synthetic";
        account.role = role;
        account.organizationId = organization.id;
        account.regions = "余杭区";
        return users.save(account);
    }

    MockMultipartFile options(String org, String region) throws Exception {
        return new MockMultipartFile("options", "options.json", "application/json",
                json.writeValueAsBytes(Map.of("organizationId", org, "region", region, "coordinateReference", "WGS84")));
    }

    ResultActions preview(String content, UserAccount actor) throws Exception {
        return mvc.perform(multipart("/api/v1/resources/airspace-imports/preview")
                .file(new MockMultipartFile("file", "测试空域.geojson", "application/geo+json", content.getBytes(StandardCharsets.UTF_8)))
                .file(options(organization.id, "余杭区")).with(user(actor.username)).with(csrf()));
    }

    JsonNode data(ResultActions action) throws Exception {
        return json.readTree(action.andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).path("data");
    }

    String previewBatch(String content, UserAccount actor) throws Exception {
        JsonNode result = data(preview(content, actor));
        assertThat(result.path("canCommit").asBoolean()).isTrue();
        return result.path("batchId").asText();
    }

    ResultActions commit(String id, UserAccount actor) throws Exception {
        return mvc.perform(post("/api/v1/resources/airspace-imports/" + id + "/commit")
                .with(user(actor.username)).with(csrf()));
    }

    String feature(String name, String geometry, String profile) {
        return "{\"type\":\"Feature\",\"id\":\"9223372036854775807\",\"properties\":{\"name\":\"" + name
                + "\",\"airspaceProfile\":" + profile + "},\"geometry\":" + geometry + "}";
    }

    List<Resource> ownResources() {
        return resources.findAll().stream().filter(resource -> organization.id.equals(resource.organizationId)).toList();
    }

    @Test
    void previewOnlyStagesAndCommitRetainsCoordinatesAndUnknownHeightsWithAudit() throws Exception {
        long beforeResources = resources.count();
        long beforeAudits = audits.count();
        String batchId = previewBatch(feature("禁飞区", polygon, "null"), admin);
        assertThat(resources.count()).isEqualTo(beforeResources);
        assertThat(audits.count()).isEqualTo(beforeAudits);
        assertThat(batches.findById(batchId).orElseThrow().status).isEqualTo("PREVIEW");
        JsonNode committed = data(commit(batchId, admin));
        assertThat(committed.path("imported").asInt()).isEqualTo(1);
        Resource resource = ownResources().getFirst();
        assertThat(resource.status).isEqualTo("PENDING_CONFIRMATION");
        JsonNode metadata = json.readTree(resource.metadata);
        assertThat(metadata.get("geometry")).isEqualTo(json.readTree(polygon));
        assertThat(metadata.path("airspaceProfile").isNull()).isTrue();
        assertThat(metadata.path("coordinateReference").asText()).isEqualTo("WGS84");
        assertThat(metadata.path("fileImport").path("featureId").asText()).isEqualTo("9223372036854775807");
        assertThat(json.readTree(resource.provenance).path("origin").asText()).isEqualTo("FILE_IMPORTED");
        assertThat(audits.count()).isEqualTo(beforeAudits + 1);
        assertThat(batches.findById(batchId).orElseThrow().normalizedPayload).isNull();
        assertThat(data(commit(batchId, admin))).isEqualTo(committed);
        assertThat(audits.count()).isEqualTo(beforeAudits + 1);
    }

    @Test
    void mixedInvalidFileCannotCreateBatchOrPartiallyImport() throws Exception {
        long beforeBatches = batches.count();
        String content = "{\"type\":\"FeatureCollection\",\"features\":[" + feature("合法", polygon, "null") + ","
                + feature("非法高度", polygon, "{\"lowerHeightMeters\":10}") + "]}";
        preview(content, admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.canCommit").value(false))
                .andExpect(jsonPath("$.data.batchId").isEmpty())
                .andExpect(jsonPath("$.data.summary.valid").value(1))
                .andExpect(jsonPath("$.data.summary.invalid").value(1));
        assertThat(batches.count()).isEqualTo(beforeBatches);
        assertThat(ownResources()).isEmpty();
    }

    @Test
    void optionsPartIsIndependentlyBoundedValidatedAndParsedWithoutScalarCoercion() throws Exception {
        for (String invalid : List.of("{\"organizationId\":\"\"}", "{}{}",
                "{\"nested\":".repeat(10) + "0" + "}".repeat(10),
                "{\"organizationId\":\"" + organization.id + "\",\"region\":\"余杭区\",\"coordinateReference\":\"WGS84\","
                        + "\"defaultAirspaceProfile\":{\"reference\":\"AGL\",\"upperHeightMeters\":\"100\"}}")) {
            mvc.perform(multipart("/api/v1/resources/airspace-imports/preview")
                    .file(new MockMultipartFile("file", "x.json", "application/json", polygon.getBytes(StandardCharsets.UTF_8)))
                    .file(new MockMultipartFile("options", "blob", "application/json", invalid.getBytes(StandardCharsets.UTF_8)))
                    .with(user(admin.username)).with(csrf())).andExpect(status().isBadRequest());
        }
        mvc.perform(multipart("/api/v1/resources/airspace-imports/preview")
                .file(new MockMultipartFile("file", "x.json", "application/json", polygon.getBytes(StandardCharsets.UTF_8)))
                .file(new MockMultipartFile("options", "blob", "application/json", new byte[8193]))
                .with(user(admin.username)).with(csrf())).andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value("AIRSPACE_OPTIONS_TOO_LARGE"));
        assertThat(ownResources()).isEmpty();
        mvc.perform(multipart("/api/v1/resources/airspace-imports/preview")
                .file(new MockMultipartFile("file", "x.json", "application/json", polygon.getBytes(StandardCharsets.UTF_8)))
                .with(user(admin.username)).with(csrf())).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    void repeatedFilesSkipExactMatchesAndNeverReplaceEditedArchives() throws Exception {
        String content = feature("重复", polygon, "{\"reference\":\"AMSL\",\"lowerHeightMeters\":-50,\"upperHeightMeters\":0}");
        data(commit(previewBatch(content, admin), admin));
        JsonNode secondPreview = data(preview(content, dispatcher));
        assertThat(secondPreview.path("summary").path("duplicates").asInt()).isEqualTo(1);
        JsonNode skipped = data(commit(secondPreview.path("batchId").asText(), dispatcher));
        assertThat(skipped.path("imported").asInt()).isZero();
        assertThat(skipped.path("skipped").asInt()).isEqualTo(1);
        Resource existing = ownResources().getFirst();
        existing.title = "手工调整后的名称";
        resources.save(existing);
        preview(content, admin).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.canCommit").value(false))
                .andExpect(jsonPath("$.data.rows[0].errors[0].code").value("AIRSPACE_IMPORT_CONFLICT"));
        assertThat(ownResources()).hasSize(1);
        assertThat(ownResources().getFirst().title).isEqualTo("手工调整后的名称");
    }

    @Test
    void conflictAfterPreviewRollsBackEveryNewResourceAndAudit() throws Exception {
        String existingFeature = feature("已有", polygon, "null");
        data(commit(previewBatch(existingFeature, admin), admin));
        Resource existing = ownResources().getFirst();
        String batchId = previewBatch("{\"type\":\"FeatureCollection\",\"features\":["
                + feature("先创建的新记录", polygon, "null") + "," + existingFeature + "]}", admin);
        existing.title = "预览之后修改";
        resources.save(existing);
        long beforeAudits = audits.count();
        commit(batchId, admin).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("AIRSPACE_IMPORT_CONFLICT"));
        assertThat(ownResources()).hasSize(1);
        assertThat(audits.count()).isEqualTo(beforeAudits);
        assertThat(batches.findById(batchId).orElseThrow().status).isEqualTo("PREVIEW");
    }

    @Test
    void expiryAndCleanupOnlyRemoveUncommittedDrafts() throws Exception {
        String expired = previewBatch(polygon, admin);
        AirspaceImportBatch draft = batches.findById(expired).orElseThrow();
        draft.expiresAt = Instant.now().minusSeconds(1);
        batches.save(draft);
        commit(expired, admin).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IMPORT_PREVIEW_EXPIRED"));
        String completed = previewBatch(feature("完成", polygon, "null"), admin);
        JsonNode result = data(commit(completed, admin));
        AirspaceImportBatch oldResult = batches.findById(completed).orElseThrow();
        oldResult.expiresAt = Instant.now().minusSeconds(1);
        batches.save(oldResult);
        service.cleanupExpiredPreviews();
        assertThat(batches.findById(expired)).isEmpty();
        assertThat(data(commit(completed, admin))).isEqualTo(result);
    }

    @Test
    void rolesActorsDestinationScopeCsrfAndCurrentGrantsAreChecked() throws Exception {
        UserAccount pilot = account(Role.PILOT);
        preview(polygon, pilot).andExpect(status().isForbidden());
        String batch = previewBatch(polygon, dispatcher);
        commit(batch, admin).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/resources/airspace-imports/" + batch + "/commit")
                .with(user(dispatcher.username))).andExpect(status().isForbidden());
        mvc.perform(multipart("/api/v1/resources/airspace-imports/preview")
                .file(new MockMultipartFile("file", "x.json", "application/json", polygon.getBytes(StandardCharsets.UTF_8)))
                .file(options(organization.id, "西湖区")).with(user(dispatcher.username)).with(csrf()))
                .andExpect(status().isForbidden());
        dispatcher.regions = "西湖区";
        users.save(dispatcher);
        commit(batch, dispatcher).andExpect(status().isForbidden());
        assertThat(ownResources()).isEmpty();
    }

    @Test
    void disabledOrganizationAndAccountCannotCommitStagedData() throws Exception {
        String batch = previewBatch(polygon, dispatcher);
        organization.status = "INACTIVE";
        organization = organizations.save(organization);
        commit(batch, dispatcher).andExpect(status().isBadRequest());
        organization.status = "ACTIVE";
        organization = organizations.save(organization);
        dispatcher.enabled = false;
        users.save(dispatcher);
        commit(batch, dispatcher).andExpect(status().isForbidden());
        assertThat(ownResources()).isEmpty();
    }

    @Test
    void concurrentCommitAndNewBatchRetriesCreateOnlyOneResource() throws Exception {
        String first = previewBatch(polygon, admin);
        String second = previewBatch(polygon, admin);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Callable<JsonNode> sameBatch = () -> data(commit(first, admin));
            var duplicateResults = executor.invokeAll(List.of(sameBatch, sameBatch));
            assertThat(duplicateResults.getFirst().get()).isEqualTo(duplicateResults.getLast().get());
            var another = executor.submit(() -> data(commit(second, admin))).get();
            assertThat(another.path("skipped").asInt()).isEqualTo(1);
        }
        assertThat(ownResources()).hasSize(1);
    }

    @Test
    void concurrentDifferentBatchesSerializeAtTheirDestinationOrganization() throws Exception {
        String first = previewBatch(polygon, admin);
        String second = previewBatch(polygon, dispatcher);
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var results = executor.invokeAll(List.<Callable<JsonNode>>of(
                    () -> data(commit(first, admin)), () -> data(commit(second, dispatcher))));
            int imported = 0;
            int skipped = 0;
            for (var result : results) {
                imported += result.get().path("imported").asInt();
                skipped += result.get().path("skipped").asInt();
            }
            assertThat(imported).isEqualTo(1);
            assertThat(skipped).isEqualTo(1);
        }
        assertThat(ownResources()).hasSize(1);
    }

    @Test
    void normalGeoJsonLargerThanOldTextCapacityPersistsOnMediumText() throws Exception {
        List<List<Double>> ring = new ArrayList<>();
        for (int i = 0; i < 1900; i++) {
            double angle = i * 2 * Math.PI / 1900;
            ring.add(List.of(120 + Math.cos(angle), 30 + Math.sin(angle), 111.222333444555));
        }
        ring.add(ring.getFirst());
        String content = json.writeValueAsString(Map.of("type", "Polygon", "coordinates", List.of(ring)));
        assertThat(content.getBytes(StandardCharsets.UTF_8).length).isGreaterThan(65535);
        data(commit(previewBatch(content, admin), admin));
        JsonNode savedRing = json.readTree(ownResources().getFirst().metadata).path("geometry").path("coordinates").get(0);
        JsonNode originalRing = json.readTree(content).path("coordinates").get(0);
        assertThat(savedRing.size()).isEqualTo(originalRing.size());
        for (int point = 0; point < originalRing.size(); point++) {
            assertThat(savedRing.get(point).size()).isEqualTo(originalRing.get(point).size());
            for (int dimension = 0; dimension < originalRing.get(point).size(); dimension++)
                assertThat(savedRing.get(point).get(dimension).decimalValue())
                        .isEqualByComparingTo(originalRing.get(point).get(dimension).decimalValue());
        }
    }

    @Test
    void highPrecisionSourceNumbersSurvivePreviewStagingCommitViewsAndDuplicateDetection() throws Exception {
        String source = "{\"type\":\"Polygon\",\"coordinates\":[[[120.123456789012345678901,30,123.123456789012345678901,9.987654321098765432109],"
                + "[121,30,124.123456789012345678901,8],[121,31,125.123456789012345678901,7],"
                + "[120.123456789012345678901,30,123.123456789012345678901,9.987654321098765432109]]]}";
        String previewBody = preview(source, admin).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(previewBody).contains("120.123456789012345678901", "123.123456789012345678901", "9.987654321098765432109");
        String batchId = json.readTree(previewBody).path("data").path("batchId").asText();
        assertThat(batches.findById(batchId).orElseThrow().normalizedPayload)
                .contains("120.123456789012345678901", "123.123456789012345678901");
        data(commit(batchId, admin));
        Resource stored = ownResources().getFirst();
        assertThat(stored.metadata).contains("120.123456789012345678901", "123.123456789012345678901", "9.987654321098765432109");
        assertThat(mvc.perform(get("/api/v1/resources/" + stored.id).with(user(admin.username)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8))
                .contains("120.123456789012345678901", "123.123456789012345678901", "9.987654321098765432109");
        JsonNode repeated = data(preview(source, admin));
        assertThat(repeated.path("canCommit").asBoolean()).isTrue();
        assertThat(repeated.path("summary").path("duplicates").asInt()).isEqualTo(1);
        assertThat(data(commit(repeated.path("batchId").asText(), admin)).path("skipped").asInt()).isEqualTo(1);
        assertThat(ownResources()).hasSize(1);
    }

    @Test
    void browserDoubleRoundTripDoesNotRewriteSourceGeometryWhenSavingNamesOrHeights() throws Exception {
        String source = "{\"type\":\"Polygon\",\"coordinates\":[[[120.123456789012345678901,30,123.123456789012345678901,9.987654321098765432109],"
                + "[122,30,124.123456789012345678901,8],[122,32,125.123456789012345678901,7],"
                + "[120.123456789012345678901,30,123.123456789012345678901,9.987654321098765432109]],"
                + "[[121.1,30.5,88.123456789012345678901],[121.2,30.5,88.123456789012345678901],[121.2,30.6,88.123456789012345678901],[121.1,30.5,88.123456789012345678901]]]}";
        data(commit(previewBatch(source, admin), admin));
        Resource stored = ownResources().getFirst();
        ObjectMapper browserJson = new ObjectMapper();
        Map<String, Object> browserMetadata = browserJson.readValue(stored.metadata,
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {});
        browserMetadata.put("airspaceProfile", Map.of("reference", "AMSL", "lowerHeightMeters", -10.5, "upperHeightMeters", 120.25));
        Map<String, Object> input = new java.util.LinkedHashMap<>();
        input.put("title", "仅修改名称和独立高度");
        input.put("kind", "AIRSPACE");
        input.put("organizationId", organization.id);
        input.put("region", "余杭区");
        input.put("metadata", browserMetadata);
        mvc.perform(put("/api/v1/resources/" + stored.id).with(user(admin.username)).with(csrf())
                .contentType("application/json").content(browserJson.writeValueAsBytes(input)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.title").value("仅修改名称和独立高度"))
                .andExpect(jsonPath("$.data.metadata.airspaceProfile.lowerHeightMeters").value(-10.5));
        JsonNode saved = json.readTree(resources.findById(stored.id).orElseThrow().metadata).get("geometry");
        assertThat(saved).isEqualTo(json.readTree(source));
        assertThat(mvc.perform(get("/api/v1/resources/" + stored.id).with(user(admin.username)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8))
                .contains("120.123456789012345678901", "123.123456789012345678901", "88.123456789012345678901");

        var browserGeometry = (com.fasterxml.jackson.databind.node.ObjectNode) browserJson.readTree(source);
        var first = (com.fasterxml.jackson.databind.node.ArrayNode) browserGeometry.path("coordinates").get(0).get(0);
        var closed = (com.fasterxml.jackson.databind.node.ArrayNode) browserGeometry.path("coordinates").get(0).get(3);
        first.set(0, browserJson.getNodeFactory().numberNode(120.2));
        closed.set(0, browserJson.getNodeFactory().numberNode(120.2));
        browserMetadata.put("geometry", browserJson.convertValue(browserGeometry,
                new com.fasterxml.jackson.core.type.TypeReference<Map<String, Object>>() {}));
        mvc.perform(put("/api/v1/resources/" + stored.id).with(user(admin.username)).with(csrf())
                .contentType("application/json").content(browserJson.writeValueAsBytes(input))).andExpect(status().isOk());
        JsonNode moved = json.readTree(resources.findById(stored.id).orElseThrow().metadata).path("geometry");
        assertThat(moved.path("coordinates").get(0).get(0).get(0).decimalValue()).isEqualByComparingTo("120.2");
        assertThat(moved.path("coordinates").get(0).get(0).get(2).decimalValue()).isEqualByComparingTo("123.123456789012345678901");
        assertThat(moved.path("coordinates").get(0).get(0).get(3).decimalValue()).isEqualByComparingTo("9.987654321098765432109");
        assertThat(moved.path("coordinates").get(1)).isEqualTo(json.readTree(source).path("coordinates").get(1));
    }

    @Test
    void previewIncludesActualMultibyteFileProvenanceInTheOneMiBResourceLimit() throws Exception {
        String filename = "测".repeat(192) + ".geojson";
        String sourceId = "号".repeat(180);
        for (int dimensions : new int[] {130_800, 130_900}) {
            String extras = ",0".repeat(dimensions);
            String geometry = "{\"type\":\"Polygon\",\"coordinates\":[[[120,30" + extras + "],[121,30" + extras
                    + "],[121,31" + extras + "],[120,30" + extras + "]]]}";
            String content = "{\"type\":\"Feature\",\"id\":\"" + sourceId
                    + "\",\"properties\":{\"name\":\"范围\"},\"geometry\":" + geometry + "}";
            JsonNode result = data(mvc.perform(multipart("/api/v1/resources/airspace-imports/preview")
                    .file(new MockMultipartFile("file", filename, "application/json", content.getBytes(StandardCharsets.UTF_8)))
                    .file(options(organization.id, "余杭区")).with(user(admin.username)).with(csrf())));
            if (dimensions == 130_800) {
                assertThat(result.path("canCommit").asBoolean()).isTrue();
                data(commit(result.path("batchId").asText(), admin));
                assertThat(ownResources().getFirst().metadata.getBytes(StandardCharsets.UTF_8).length).isLessThanOrEqualTo(1024 * 1024);
            } else {
                assertThat(result.path("canCommit").asBoolean()).isFalse();
                assertThat(result.path("batchId").isNull()).isTrue();
                assertThat(result.path("rows").get(0).path("errors").get(0).path("message").asText()).contains("含文件来源信息");
            }
        }
        assertThat(ownResources()).hasSize(1);
    }

    @Test
    void manualResourceSaveUsesTheSameHeightAndGeometryRulesAndRetainsLegacyGeometry() throws Exception {
        Map<String, Object> metadata = new java.util.LinkedHashMap<>();
        metadata.put("geometry", json.readTree(polygon));
        metadata.put("airspaceProfile", Map.of("reference", "AMSL", "lowerHeightMeters", -100, "upperHeightMeters", 20));
        Map<String, Object> input = new java.util.LinkedHashMap<>();
        input.put("title", "手绘空域");
        input.put("kind", "AIRSPACE");
        input.put("organizationId", organization.id);
        input.put("region", "余杭区");
        input.put("metadata", metadata);
        mvc.perform(post("/api/v1/resources").with(user(admin.username)).with(csrf())
                .contentType("application/json").content(json.writeValueAsBytes(input)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.metadata.airspaceProfile.lowerHeightMeters").value(-100));
        metadata.put("airspaceProfile", Map.of("reference", "AGL", "lowerHeightMeters", -1));
        mvc.perform(post("/api/v1/resources").with(user(admin.username)).with(csrf())
                .contentType("application/json").content(json.writeValueAsBytes(input))).andExpect(status().isBadRequest());
        assertThat(ownResources()).hasSize(1);
        Resource legacy = new Resource();
        legacy.title = "旧来源线状围栏";
        legacy.kind = "AIRSPACE";
        legacy.status = "PENDING_CONFIRMATION";
        legacy.organizationId = organization.id;
        legacy.region = "余杭区";
        legacy.metadata = "{\"coordinateReference\":\"SOURCE_MAP_UNSPECIFIED\",\"geometry\":{\"type\":\"LineString\",\"coordinates\":[[120,30,99],[121,31,100]]}}";
        legacy = resources.save(legacy);
        input.put("title", "只修改旧档案名称");
        input.put("metadata", json.readTree(legacy.metadata));
        mvc.perform(put("/api/v1/resources/" + legacy.id).with(user(admin.username)).with(csrf())
                .contentType("application/json").content(json.writeValueAsBytes(input))).andExpect(status().isOk());
        assertThat(json.readTree(resources.findById(legacy.id).orElseThrow().metadata)).isEqualTo(json.readTree(legacy.metadata));
    }
}
