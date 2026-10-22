package com.oneflight.web;

import com.oneflight.auth.FourAIdentityService;
import com.oneflight.auth.FourAProperties;
import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.common.ApiResponse;
import com.oneflight.common.PageResult;
import com.oneflight.domain.ExternalIdentity;
import com.oneflight.integration.FourAAccountDirectory;
import com.oneflight.repository.ExternalIdentityRepository;
import com.oneflight.repository.UserAccountRepository;
import com.oneflight.service.AuditService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
public class FourAAccountDirectoryController {
    private final ScopeService scope;
    private final FourAProperties properties;
    private final FourAAccountDirectory directory;
    private final FourAIdentityService projections;
    private final ExternalIdentityRepository identities;
    private final UserAccountRepository users;
    private final AuditService audit;

    public FourAAccountDirectoryController(ScopeService scope, FourAProperties properties,
            FourAAccountDirectory directory, FourAIdentityService projections, ExternalIdentityRepository identities,
            UserAccountRepository users, AuditService audit) {
        this.scope = scope; this.properties = properties; this.directory = directory; this.projections = projections;
        this.identities = identities; this.users = users; this.audit = audit;
    }

    @GetMapping("/4a-directory")
    public ApiResponse<?> search(@RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize, @RequestParam(required = false) String query,
            HttpServletResponse response) {
        requireAdministrator();
        response.setHeader("Cache-Control", "no-store");
        var result = directory.search(page, pageSize, query);
        var existing = identities.findByIssuerAndExternalUserIdIn(properties.issuer,
                result.items().stream().map(FourAAccountDirectory.Account::externalUserId).toList()).stream()
                .collect(Collectors.toMap(identity -> identity.externalUserId, Function.identity()));
        var items = result.items().stream().map(account -> view(account, existing.get(account.externalUserId()))).toList();
        return ApiResponse.ok(new PageResult<>(items, result.total(), result.page(), result.pageSize()));
    }

    public record LinkInput(@NotBlank @Size(max = 160) String externalUserId) {}

    @PostMapping("/4a-link")
    public ApiResponse<?> link(@Valid @RequestBody LinkInput input, HttpServletResponse response) {
        requireAdministrator();
        response.setHeader("Cache-Control", "no-store");
        var verified = directory.requireAvailable(input.externalUserId());
        var identity = projections.linkVerified(verified);
        var account = users.findById(identity.userId).orElseThrow(ApiException::missing);
        audit.record("USER", account.id, account.organizationId, null, "LINK_4A_ACCOUNT", null);
        return ApiResponse.ok(projections.userView(account));
    }

    private void requireAdministrator() {
        scope.requireRole(Role.ADMIN);
        if (!properties.isFourA()) throw new ApiException(HttpStatus.FORBIDDEN, "FOUR_A_MODE_REQUIRED", "仅在4A认证模式下关联4A账号");
    }

    private static Map<String, Object> view(FourAAccountDirectory.Account account, ExternalIdentity identity) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("externalUserId", account.externalUserId()); row.put("username", account.username());
        row.put("displayName", account.displayName()); row.put("externalGroupName", account.externalGroupName());
        row.put("available", account.available()); row.put("unavailableReason", account.unavailableReason());
        row.put("linked", identity != null && identity.userId != null);
        row.put("userId", identity == null ? null : identity.userId);
        row.put("businessAccessAssigned", identity != null && identity.businessAccessAssigned);
        return row;
    }
}
