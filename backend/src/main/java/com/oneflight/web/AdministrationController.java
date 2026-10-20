package com.oneflight.web;

import com.oneflight.auth.*;
import com.oneflight.common.*;
import com.oneflight.domain.*;
import com.oneflight.service.*;
import com.oneflight.web.Requests.*;

import jakarta.validation.Valid;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class AdministrationController {
    private final WorkflowService service;
    private final ScopeService scope;
    private final PasswordEncoder encoder;
    private final AuditService audit;

    public AdministrationController(
            WorkflowService service,
            ScopeService scope,
            PasswordEncoder encoder,
            AuditService audit) {
        this.service = service;
        this.scope = scope;
        this.encoder = encoder;
        this.audit = audit;
    }

    @GetMapping("/users")
    public ApiResponse<?> users(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) Role role,
            @RequestParam(required = false) String query) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
        return ApiResponse.ok(
                PageResult.of(
                        service.users().findAll().stream()
                                .filter(x -> scope.canAccess(x.organizationId, null))
                                .filter(x -> role == null || x.role == role)
                                .filter(
                                        x ->
                                                query == null
                                                        || query.isBlank()
                                                        || x.displayName.contains(query)
                                                        || x.username.contains(query))
                                .map(UserAccount::view)
                                .toList(),
                        page,
                        pageSize));
    }

    @PostMapping("/users")
    @Transactional
    public ApiResponse<?> createUser(@Valid @RequestBody UserInput input) {
        return saveUser(null, input);
    }

    @PutMapping("/users/{id}")
    @Transactional
    public ApiResponse<?> updateUser(@PathVariable String id, @Valid @RequestBody UserInput input) {
        return saveUser(id, input);
    }

    private ApiResponse<?> saveUser(String id, UserInput in) {
        scope.requireRole(Role.ADMIN);
        if (!service.organizations().existsById(in.organizationId()))
            throw ApiException.invalid("组织不存在");
        var u =
                id == null
                        ? new UserAccount()
                        : service.users().findById(id).orElseThrow(ApiException::missing);
        if (id == null && (in.password() == null || in.password().isBlank()))
            throw ApiException.invalid("初始密码至少12位");
        if (Objects.equals(u.id, scope.currentUser().id())
                && (in.role() != Role.ADMIN || Boolean.FALSE.equals(in.enabled())))
            throw ApiException.invalid("不能停用或降级当前管理员");
        u.provenance = RecordProvenance.apply(u.provenance, in.provenance(), scope.currentUser());
        u.username = in.username();
        u.displayName = in.displayName();
        u.role = in.role();
        u.organizationId = in.organizationId();
        u.regions = String.join(",", in.regions() == null ? Set.of() : in.regions());
        u.deviceIds = String.join(",", in.deviceIds() == null ? Set.of() : in.deviceIds());
        Set<String> grants =
                in.organizationIds() == null
                        ? UserAccount.split(u.organizationIds)
                        : in.organizationIds();
        if (grants.stream()
                .anyMatch(org -> org == null || !service.organizations().existsById(org))) {
            throw ApiException.invalid("授权组织不存在");
        }
        u.organizationIds = in.role() == Role.DISPATCH ? String.join(",", grants) : "";
        u.enabled = in.enabled() == null || in.enabled();
        if (in.password() != null && !in.password().isBlank())
            u.passwordHash = encoder.encode(in.password());
        service.users().save(u);
        audit.record("USER", u.id, u.organizationId, null, id == null && "BUSINESS_INITIALIZATION".equals(RecordProvenance.view(u.provenance).get("origin")) ? "INITIALIZE" : id == null ? "CREATE" : "UPDATE", null);
        return ApiResponse.ok(u.view());
    }

    @GetMapping("/audit")
    public ApiResponse<?> audit(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        return ApiResponse.ok(
                PageResult.of(
                        service.events().findAll().stream()
                                .filter(x -> scope.canAccess(x.organizationId, x.region))
                                .filter(
                                        x ->
                                                query == null
                                                        || query.isBlank()
                                                        || x.action.contains(query)
                                                        || x.actorName.contains(query))
                                .sorted(
                                        Comparator.comparing((AuditEvent x) -> x.createdAt)
                                                .reversed())
                                .map(AuditEvent::view)
                                .toList(),
                        page,
                        pageSize));
    }

    @GetMapping("/settings")
    public ApiResponse<?> settings(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        scope.requireRole(Role.ADMIN);
        return ApiResponse.ok(
                PageResult.of(
                        service.settings().findAll().stream().map(PlatformSetting::view).toList(),
                        page,
                        pageSize));
    }

    @PutMapping("/settings/{key}")
    @Transactional
    public ApiResponse<?> setting(@PathVariable String key, @Valid @RequestBody SettingInput in) {
        scope.requireRole(Role.ADMIN);
        if (!Set.of(
                        "platformName",
                        "contactPhone",
                        "defaultRegion",
                        "mapStyleUrl",
                        "mapSatelliteUrl",
                        "mapTerrainUrl")
                .contains(key)) throw ApiException.invalid("此配置须通过后端私有环境变量管理");
        var s = service.settings().findById(key).orElseGet(PlatformSetting::new);
        s.id = key;
        s.value = in.value();
        s.updatedAt = Instant.now();
        service.settings().save(s);
        audit.record("SETTING", key, scope.currentUser().organizationId(), null, "UPDATE", null);
        return ApiResponse.ok(s.view());
    }

    @GetMapping("/config")
    public ApiResponse<?> config(
            @org.springframework.beans.factory.annotation.Value("${oneflight.map.style-url:}")
                    String style,
            @org.springframework.beans.factory.annotation.Value("${oneflight.map.satellite-url:}")
                    String satellite,
            @org.springframework.beans.factory.annotation.Value("${oneflight.map.terrain-url:}")
                    String terrain) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("mapStyleUrl", value("mapStyleUrl", style));
        map.put("mapSatelliteUrl", value("mapSatelliteUrl", satellite));
        map.put("mapTerrainUrl", value("mapTerrainUrl", terrain));
        map.put("defaultRegion", value("defaultRegion", "杭州市"));
        map.put("platformName", value("platformName", "一网统飞平台"));
        map.put("timeZone", "Asia/Shanghai");
        return ApiResponse.ok(map);
    }

    private String value(String key, String defaultValue) {
        return service.settings()
                .findById(key)
                .map(x -> x.value)
                .filter(v -> v != null && !v.isBlank())
                .orElse(defaultValue);
    }
}
