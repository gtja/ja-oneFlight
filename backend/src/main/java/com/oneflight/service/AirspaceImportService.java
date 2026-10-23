package com.oneflight.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.domain.AirspaceImportBatch;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.integration.AirspaceFileParser;
import com.oneflight.integration.AirspaceFileParser.Entry;
import com.oneflight.repository.AirspaceImportBatchRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.web.AirspaceImportDtos.CommitResult;
import com.oneflight.web.AirspaceImportDtos.ImportOptions;
import com.oneflight.web.AirspaceImportDtos.Issue;
import com.oneflight.web.AirspaceImportDtos.PreviewResult;
import com.oneflight.web.AirspaceImportDtos.PreviewRow;
import com.oneflight.web.AirspaceImportDtos.Summary;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Service
public class AirspaceImportService {
    private static final Set<String> REGIONS = Set.of("上城区", "拱墅区", "西湖区", "余杭区", "萧山区");
    private final AirspaceImportBatchRepository batches;
    private final ResourceRepository resources;
    private final OrganizationRepository organizations;
    private final ScopeService scope;
    private final AuditService audit;
    private final AirspaceFileParser parser;
    private final AirspacePolicy policy;
    private final ObjectMapper json = new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);

    public AirspaceImportService(AirspaceImportBatchRepository batches, ResourceRepository resources,
            OrganizationRepository organizations, ScopeService scope, AuditService audit,
            AirspaceFileParser parser, AirspacePolicy policy) {
        this.batches = batches;
        this.resources = resources;
        this.organizations = organizations;
        this.scope = scope;
        this.audit = audit;
        this.parser = parser;
        this.policy = policy;
    }

    @Transactional
    public PreviewResult preview(MultipartFile file, ImportOptions options) {
        requireDestination(options.organizationId(), options.region(), false);
        var parsed = parser.parse(file, options);
        AirspaceImportBatch batch = new AirspaceImportBatch();
        batch.createdBy = scope.currentUser().id();
        batch.organizationId = options.organizationId();
        batch.region = options.region();
        batch.status = "PREVIEW";
        batch.filename = parsed.filename();
        batch.fileHash = parsed.fileHash();
        batch.createdAt = Instant.now();
        batch.expiresAt = batch.createdAt.plus(15, ChronoUnit.MINUTES);
        List<PreviewRow> rows = new ArrayList<>();
        Map<Integer, Entry> entries = new LinkedHashMap<>();
        parsed.entries().forEach(entry -> entries.put(entry.index(), entry));
        for (PreviewRow row : parsed.rows()) {
            List<Issue> errors = new ArrayList<>(row.errors());
            List<Issue> warnings = new ArrayList<>(row.warnings());
            boolean duplicate = row.duplicate();
            Entry entry = entries.get(row.index());
            if (errors.isEmpty() && entry != null) {
                // All provenance fields are exact; only the timestamp uses its maximum serialized length.
                if (policy.bytes(importMetadata(entry, batch, "9999-12-31T23:59:59.999999999Z")) > AirspacePolicy.MAX_RESOURCE_BYTES)
                    errors.add(new Issue("INVALID_REQUEST", "单个空域扩展数据不得超过1MiB（含文件来源信息）"));
                Resource previous = resources.findById(resourceId(options.organizationId(), options.region(), entry)).orElse(null);
                if (previous != null) {
                    try {
                        requireMatching(previous, options.organizationId(), options.region(), entry);
                        duplicate = true;
                        warnings.add(new Issue("ALREADY_IMPORTED", "已存在完全相同的文件空域，提交时自动跳过"));
                    } catch (ApiException e) { errors.add(new Issue(e.getCode(), e.getMessage())); }
                }
            }
            rows.add(new PreviewRow(row.index(), row.title(), row.model(), row.description(), row.geometry(),
                    row.airspaceProfile(), row.pointCount(), duplicate, List.copyOf(errors), List.copyOf(warnings)));
        }
        int invalid = (int) rows.stream().filter(row -> !row.errors().isEmpty()).count();
        Summary summary = new Summary(rows.size(), rows.size() - invalid, invalid,
                (int) rows.stream().filter(PreviewRow::duplicate).count(), parsed.summary().pointCount());
        if (invalid > 0) return new PreviewResult(null, null, false, summary, List.copyOf(rows));
        batch.normalizedPayload = policy.json(parsed.entries());
        batch.payloadHash = policy.fingerprint(policy.tree(parsed.entries()));
        batches.save(batch);
        return new PreviewResult(batch.id, batch.expiresAt, true, summary, List.copyOf(rows));
    }

    @Transactional
    public CommitResult commit(String batchId) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        AirspaceImportBatch batch = batches.findLockedById(batchId).orElseThrow(() ->
                new ApiException(HttpStatus.CONFLICT, "IMPORT_PREVIEW_EXPIRED", "导入预览已失效，请重新选择文件预览"));
        if (!Objects.equals(batch.createdBy, scope.currentUser().id())) throw ApiException.forbidden();
        requireDestination(batch.organizationId, batch.region, true);
        if ("COMMITTED".equals(batch.status)) return result(batch);
        if (!"PREVIEW".equals(batch.status) || !batch.expiresAt.isAfter(Instant.now()))
            throw new ApiException(HttpStatus.CONFLICT, "IMPORT_PREVIEW_EXPIRED", "导入预览已过期，请重新选择文件预览");
        List<Entry> entries = entries(batch);
        int imported = 0;
        int skipped = 0;
        Set<String> ids = new LinkedHashSet<>();
        for (Entry entry : entries) {
            policy.geometry(entry.geometry());
            policy.profile(policy.tree(entry.airspaceProfile()));
            String id = resourceId(batch.organizationId, batch.region, entry);
            // A locking read sees the latest committed archive under MySQL REPEATABLE READ too.
            Resource previous = resources.findLockedById(id).orElse(null);
            if (previous != null) {
                requireMatching(previous, batch.organizationId, batch.region, entry);
                ids.add(id);
                skipped++;
                continue;
            }
            Resource resource = new Resource();
            resource.id = id;
            resource.title = entry.title();
            resource.model = entry.model();
            resource.kind = "AIRSPACE";
            resource.status = "PENDING_CONFIRMATION";
            resource.organizationId = batch.organizationId;
            resource.region = batch.region;
            resource.createdBy = batch.createdBy;
            var metadata = importMetadata(entry, batch, Instant.now().toString());
            if (policy.bytes(metadata) > AirspacePolicy.MAX_RESOURCE_BYTES)
                throw ApiException.invalid("单个空域扩展数据不得超过1MiB");
            resource.metadata = policy.json(metadata);
            resource.provenance = policy.json(Map.of("origin", "FILE_IMPORTED", "recordedBy", batch.createdBy,
                    "recordedAt", Instant.now().toString(), "batchId", batch.id, "description", "本地文件导入，待确认，不代表监管审批"));
            resources.saveAndFlush(resource);
            audit.record("RESOURCE", resource, "FILE_IMPORT", "本地空域文件导入，待确认；批次 " + batch.id);
            ids.add(id);
            imported++;
        }
        CommitResult result = new CommitResult(batch.id, "COMMITTED", imported, skipped, List.copyOf(ids), Instant.now().toString());
        batch.status = "COMMITTED";
        batch.committedAt = Instant.parse(result.importedAt());
        batch.resultJson = policy.json(result);
        batch.normalizedPayload = null;
        batches.save(batch);
        return result;
    }

    /** Draft cleanup is independent of sources; completed results remain for safe retries. */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 3_600_000)
    @Transactional
    public void cleanupExpiredPreviews() { batches.deleteExpiredPreviews(Instant.now()); }

    private void requireDestination(String organizationId, String region, boolean locked) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        if (organizationId == null || organizationId.isBlank() || !REGIONS.contains(region))
            throw ApiException.invalid("请选择有效的业务组织及所属区域");
        if (!scope.canAccess(organizationId, region)) throw ApiException.forbidden();
        Organization organization = (locked ? organizations.findLockedById(organizationId) : organizations.findById(organizationId))
                .orElseThrow(() -> ApiException.invalid("组织不存在"));
        if (!"ACTIVE".equals(organization.status)) throw ApiException.invalid("所属组织已停用，请选择已启用的组织");
    }

    private List<Entry> entries(AirspaceImportBatch batch) {
        try {
            List<Entry> result = Arrays.asList(json.readValue(batch.normalizedPayload, Entry[].class));
            if (result.isEmpty() || result.size() > AirspaceFileParser.MAX_FEATURES
                    || !Objects.equals(batch.payloadHash, policy.fingerprint(policy.tree(result))))
                throw conflict();
            return result;
        } catch (JsonProcessingException | IllegalArgumentException e) { throw conflict(); }
    }

    private CommitResult result(AirspaceImportBatch batch) {
        try { return json.readValue(batch.resultJson, CommitResult.class); }
        catch (JsonProcessingException e) { throw conflict(); }
    }

    private void requireMatching(Resource resource, String organizationId, String region, Entry entry) {
        scope.requireAccess(resource);
        if (!"AIRSPACE".equals(resource.kind) || !Objects.equals(resource.organizationId, organizationId)
                || !Objects.equals(resource.region, region)) throw conflict();
        JsonNode metadata = policy.read(resource.metadata);
        if (!entry.fingerprint().equals(metadata.path("fileImport").path("contentHash").asText())) throw conflict();
        try {
            String description = metadata.path("description").isTextual() ? metadata.path("description").textValue() : null;
            String current = policy.fingerprint(parser.content(resource.title, resource.model, description,
                    metadata.get("geometry"), policy.profile(metadata.get("airspaceProfile"))));
            if (!entry.fingerprint().equals(current)) throw conflict();
        } catch (ApiException e) { throw conflict(); }
    }

    private String resourceId(String organizationId, String region, Entry entry) {
        return UUID.nameUUIDFromBytes(("oneflight:airspace-file:" + organizationId + ":" + region + ":" + entry.fingerprint())
                .getBytes(StandardCharsets.UTF_8)).toString();
    }

    private ObjectNode importMetadata(Entry entry, AirspaceImportBatch batch, String importedAt) {
        var metadata = parser.metadata(entry);
        Map<String, Object> fileImport = new LinkedHashMap<>();
        fileImport.put("batchId", batch.id);
        fileImport.put("filename", batch.filename);
        fileImport.put("fileHash", batch.fileHash);
        fileImport.put("featureId", entry.sourceFeatureId());
        fileImport.put("contentHash", entry.fingerprint());
        fileImport.put("importedAt", importedAt);
        metadata.set("fileImport", policy.tree(fileImport));
        return metadata;
    }

    private ApiException conflict() {
        return new ApiException(HttpStatus.CONFLICT, "AIRSPACE_IMPORT_CONFLICT", "相同文件空域的已有档案已变更或批次冲突，请核对后重新预览；不会覆盖已有档案");
    }
}
