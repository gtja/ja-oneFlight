package com.oneflight.integration;

import com.oneflight.auth.AccessScope;
import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.service.AuditService;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Explicit administrator import of source archives; no users, approvals or execution successes are manufactured. */
@Service
public class BusinessSourceImporter {
    private static final Map<String, String> SOURCE_KINDS = Map.of("PERSON", "people", "ROUTE", "routes", "AIRSPACE", "airspaces", "ORGANIZATION", "groups");
    private static final Set<String> ALLOWED = Set.of("DEVICE", "PERSON", "ROUTE", "AIRSPACE", "ORGANIZATION");
    private final BusinessSourceCatalog catalog;
    private final DeviceDirectory directory;
    private final ResourceRepository resources;
    private final OrganizationRepository organizations;
    private final AccessScope scope;
    private final AuditService audit;

    public BusinessSourceImporter(BusinessSourceCatalog catalog, DeviceDirectory directory, ResourceRepository resources,
            OrganizationRepository organizations, AccessScope scope, AuditService audit) {
        this.catalog = catalog; this.directory = directory; this.resources = resources; this.organizations = organizations;
        this.scope = scope; this.audit = audit;
    }

    @Transactional
    public synchronized Map<String, Object> importArchives(Set<String> kinds, int limit) {
        if (scope.currentUser().role() != Role.ADMIN) { throw ApiException.forbidden(); }
        if (kinds == null || kinds.isEmpty() || !ALLOWED.containsAll(kinds) || limit < 1 || limit > 2000) { throw ApiException.invalid("导入类型或数量无效"); }
        Set<String> before = new LinkedHashSet<>(directory.allowedIds());
        Map<String, SourceModels.Device> beforeDevices = Map.copyOf(directory.authorized());
        Map<String, List<Map<String, Object>>> source = new LinkedHashMap<>();
        // Finish all reads before changing business data: failed sources cannot leave partial imports.
        for (String kind : new TreeSet<>(kinds)) { source.put(kind, "DEVICE".equals(kind) ? devices(before, limit) : read(SOURCE_KINDS.get(kind), limit)); }
        requireScope(before, beforeDevices);
        List<Resource> existing = new ArrayList<>(resources.findAll());
        Map<String, Resource> byKey = new HashMap<>(); Map<String, Resource> byDevice = new HashMap<>();
        for (Resource resource : existing) {
            String key = sourceKey(resource.metadata); if (key != null) { byKey.put(key, resource); }
            if (resource.sourceDeviceId != null && !resource.sourceDeviceId.isBlank()) { byDevice.put(resource.sourceDeviceId, resource); }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, List<Map<String, Object>>> entry : source.entrySet()) {
            String kind = entry.getKey(); int imported = 0; int skipped = 0; List<String> ids = new ArrayList<>();
            for (Map<String, Object> row : entry.getValue()) {
                String key = importKey(row); String id = deterministicId(kind, key);
                if ("ORGANIZATION".equals(kind)) {
                    if (organizations.existsById(id)) { skipped++; continue; }
                    Organization organization = new Organization(); organization.id = id; defaults(organization, row);
                    organization.provenance = json(provenance(row, key));
                    organization.contact = "来源 ja-4a.groups/" + row.get("sourceId") + "；独立来源档案，未授本地审批权限";
                    organizations.save(organization); audit.record("organizations", organization, "SOURCE_IMPORT", "导入真实来源组织档案，不改变本地账号授权");
                    ids.add(id); imported++; continue;
                }
                String sourceDeviceId = "DEVICE".equals(kind) ? text(row.get("id")) : null;
                if (byKey.containsKey(key) || (sourceDeviceId != null && byDevice.containsKey(sourceDeviceId)) || resources.existsById(id)) { skipped++; continue; }
                Resource resource = new Resource(); resource.id = id; defaults(resource, row); resource.kind = kind;
                resource.model = text(row.get("model"));
                if (resource.model == null) { resource.model = switch (kind) {
                    case "PERSON" -> "资质待核验";
                    case "DEVICE" -> text(row.get("sourceDeviceType"));
                    case "ROUTE" -> text(row.get("taskType"));
                    case "AIRSPACE" -> text(row.get("sourceType"));
                    default -> null;
                }; }
                resource.sourceDeviceId = sourceDeviceId; resource.productKey = text(row.get("productKey")); resource.sn = text(row.get("sn"));
                resource.longitude = number(row.get("longitude")); resource.latitude = number(row.get("latitude"));
                Map<String, Object> metadata = new LinkedHashMap<>(row);
                metadata.put("sourceImport", provenance(row, key)); metadata.put("description", "真实来源档案导入，待核对本地使用范围；来源状态及原始时间见来源信息");
                if ("PERSON".equals(kind)) { metadata.put("qualificationStatus", "UNKNOWN"); metadata.put("qualificationNote", "来源未提供已核验飞手资质，未开通本地登录账号"); }
                resource.metadata = json(metadata);
                // Preserve the source archive while avoiding overflow of the database TEXT field.
                if (resource.metadata.getBytes(StandardCharsets.UTF_8).length > 60_000) {
                    metadata.put("geometry", null); metadata.put("geometryStatus", "SOURCE_GEOMETRY_TOO_LARGE"); resource.metadata = json(metadata);
                }
                resource.provenance = json(provenance(row, key));
                resources.save(resource); audit.record("resources", resource, "SOURCE_IMPORT", "导入真实来源档案，待本地确认");
                byKey.put(key, resource); if (sourceDeviceId != null) { byDevice.put(sourceDeviceId, resource); }
                ids.add(id); imported++;
            }
            result.put(kind, Map.of("read", entry.getValue().size(), "imported", imported, "skipped", skipped, "ids", ids));
        }
        requireScope(before, beforeDevices); result.put("importedAt", Instant.now().toString()); result.put("status", "PENDING_CONFIRMATION"); return result;
    }

    private List<Map<String, Object>> read(String kind, int limit) {
        List<Map<String, Object>> rows = new ArrayList<>();
        int pageSize = Math.min(100, limit);
        for (int page = 1; rows.size() < limit; page++) {
            var data = catalog.list(kind, page, pageSize); rows.addAll(data.items());
            // Keep a constant page size to prevent repeated rows when the final page is shorter.
            if (data.items().isEmpty() || (long) page * data.pageSize() >= data.total() || rows.size() >= limit) { break; }
        }
        return rows.subList(0, Math.min(rows.size(), limit));
    }

    private List<Map<String, Object>> devices(Set<String> allowed, int limit) {
        return directory.authorized().values().stream().filter(d -> allowed.contains(d.id())).sorted(Comparator.comparing(SourceModels.Device::id)).limit(limit).map(d -> {
            Map<String, Object> row = new LinkedHashMap<>(); row.put("id", d.id()); row.put("sourceId", d.id()); row.put("title", d.name() == null ? d.id() : d.name());
            row.put("sourceSystem", "controlServer"); row.put("sourceEntity", "device"); row.put("productKey", d.productKey()); row.put("sn", d.sn());
            row.put("sourceOrganizationCode", d.sourceOrganizationCode()); row.put("sourceDeviceType", d.type()); row.put("sourceParentDeviceId", d.parentDeviceId());
            row.put("sourceStatus", "UNKNOWN"); row.put("longitude", d.longitude()); row.put("latitude", d.latitude()); return row;
        }).toList();
    }

    private void defaults(com.oneflight.domain.BaseRecord record, Map<String, Object> row) {
        String title = text(row.get("title")); record.title = title == null || title.isBlank() ? "来源档案 " + row.get("id") : title.substring(0, Math.min(180, title.length()));
        record.organizationId = scope.currentUser().organizationId(); record.createdBy = scope.currentUser().id();
        record.region = "来源未提供"; record.status = "PENDING_CONFIRMATION";
    }
    private Map<String, Object> provenance(Map<String, Object> row, String key) {
        Map<String, Object> result = new LinkedHashMap<>(); result.put("system", row.get("sourceSystem")); result.put("entity", row.get("sourceEntity"));
        result.put("id", row.get("sourceId")); result.put("key", key); result.put("importedAt", Instant.now().toString());
        result.put("origin", "SOURCE_IMPORTED"); result.put("sourceSystem", row.get("sourceSystem")); result.put("sourceEntity", row.get("sourceEntity")); result.put("sourceId", row.get("sourceId")); result.put("sourceStatus", row.get("sourceStatus")); result.put("sourceCreatedAt", row.get("sourceCreatedAt")); result.put("sourceUpdatedAt", row.get("sourceUpdatedAt"));
        result.put("sourceOrganizationCode", row.get("sourceOrganizationCode")); result.put("sourceOrganizationName", row.get("sourceOrganizationName"));
        result.put("sourceParentId", row.get("sourceParentId")); result.put("description", "真实来源档案，本地归档不代表来源资质认证或审批授权"); return result;
    }
    private void requireScope(Set<String> before, Map<String, SourceModels.Device> beforeDevices) {
        if (!directory.allowedIds().containsAll(before)) { throw ProviderJson.failure("来源授权已变化，导入已回滚，请重试"); }
        Map<String, SourceModels.Device> after = directory.authorized();
        for (String id : before) {
            if (!after.containsKey(id) || !beforeDevices.containsKey(id)
                    || !Objects.equals(beforeDevices.get(id).sourceOrganizationCode(), after.get(id).sourceOrganizationCode())) {
                throw ProviderJson.failure("来源组织授权已变化，导入已回滚，请重试");
            }
        }
    }
    static String importKey(Map<String, Object> row) { return row.get("sourceSystem") + ":" + row.get("sourceEntity") + ":" + row.get("sourceId"); }
    static String deterministicId(String kind, String key) { return UUID.nameUUIDFromBytes(("oneflight:source:" + kind + ":" + key).getBytes(StandardCharsets.UTF_8)).toString(); }
    static String sourceKey(String metadata) { try { var root = ProviderJson.JSON.readTree(metadata); return root.path("sourceImport").path("key").isTextual() ? root.path("sourceImport").path("key").textValue() : null; } catch (Exception e) { return null; } }
    private static String json(Object value) { try { return ProviderJson.JSON.writeValueAsString(value); } catch (Exception e) { throw ApiException.invalid("来源档案格式无效"); } }
    private static String text(Object value) { return value == null ? null : value.toString(); }
    private static Double number(Object value) { return value instanceof Number n ? n.doubleValue() : null; }
}
