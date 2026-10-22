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
    private final FourAProperties fourA;
    private final FourAIdentityService identities;

    public AdministrationController(
            WorkflowService service,
            ScopeService scope,
            PasswordEncoder encoder,
            AuditService audit,
            FourAProperties fourA,
            FourAIdentityService identities) {
        this.service = service;
        this.scope = scope;
        this.encoder = encoder;
        this.audit = audit;
        this.fourA = fourA;
        this.identities = identities;
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
                                .filter(x -> !fourA.isFourA() || identities.isFourAAccount(x.id))
                                .filter(x -> scope.canAccess(x.organizationId, null))
                                .filter(x -> role == null || x.role == role)
                                .map(identities::userView)
                                .filter(
                                        x ->
                                                query == null
                                                        || query.isBlank()
                                                        || String.valueOf(x.get("displayName")).contains(query)
                                                        || String.valueOf(x.get("username")).contains(query))
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
        if (fourA.isFourA())
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                    "IDENTITY_MANAGED_BY_4A", "账号身份由 4A 管理，请通过业务权限入口配置平台角色和授权");
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

    @PutMapping("/users/{id}/permissions")
    @Transactional
    public ApiResponse<?> updateBusinessPermissions(
            @PathVariable String id, @Valid @RequestBody BusinessPermissionsInput in) {
        scope.requireRole(Role.ADMIN);
        if (!service.users().existsById(id)) throw ApiException.missing();
        if (fourA.isFourA() && !identities.isFourAAccount(id))
            throw ApiException.invalid("此账号尚未通过 4A 身份认证");
        if (!service.organizations().existsById(in.organizationId()))
            throw ApiException.invalid("组织不存在");
        if (Objects.equals(id, scope.currentUser().id())
                && (in.role() != Role.ADMIN || Boolean.FALSE.equals(in.enabled())))
            throw ApiException.invalid("不能停用或降级当前管理员");
        Set<String> grants = in.organizationIds() == null ? Set.of() : in.organizationIds();
        if (grants.stream().anyMatch(org -> org == null || !service.organizations().existsById(org)))
            throw ApiException.invalid("授权组织不存在");
        // Identity metadata refresh locks identity before user. Use the same order here; both
        // permission assignment and the local grants commit in this transaction together.
        identities.grantBusinessAccess(id);
        UserAccount account = service.users().findLockedById(id).orElseThrow(ApiException::missing);
        account.role = in.role();
        account.organizationId = in.organizationId();
        account.regions = String.join(",", in.regions() == null ? Set.of() : in.regions());
        account.deviceIds = String.join(",", in.deviceIds() == null ? Set.of() : in.deviceIds());
        account.organizationIds = in.role() == Role.DISPATCH ? String.join(",", grants) : "";
        account.enabled = in.enabled() == null || in.enabled();
        service.users().save(account);
        audit.record("USER", id, account.organizationId, null, "UPDATE_PERMISSIONS", null);
        return ApiResponse.ok(identities.userView(account));
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
