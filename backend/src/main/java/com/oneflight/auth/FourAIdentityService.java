package com.oneflight.auth;

import com.oneflight.common.ApiException;
import com.oneflight.domain.ExternalIdentity;
import com.oneflight.domain.UserAccount;
import com.oneflight.domain.Organization;
import com.oneflight.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;

/** A local business projection of the verified 4A directory, not a second account directory. */
@Service
public class FourAIdentityService {
    private final ExternalIdentityRepository identities;
    private final UserAccountRepository users;
    private final FourAProperties properties;
    private final String initialAdministratorId;
    private final OrganizationRepository organizations;
    private final TransactionTemplate projectionTransaction;
    private final Object projectionMonitor = new Object();

    public FourAIdentityService(ExternalIdentityRepository identities, UserAccountRepository users,
            FourAProperties properties, OrganizationRepository organizations,
            @org.springframework.beans.factory.annotation.Value("${oneflight.auth.bootstrap-four-a-user-id:}") String initialAdministratorId,
            PlatformTransactionManager transactionManager) {
        this.identities = identities; this.users = users; this.properties = properties;
        this.initialAdministratorId = initialAdministratorId.trim();
        this.organizations = organizations;
        this.projectionTransaction = new TransactionTemplate(transactionManager);
        this.projectionTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public ExternalIdentity remember(FourAClient.Profile profile) {
        synchronized (projectionMonitor) {
            return projectionTransaction.execute(status -> rememberVerified(profile));
        }
    }

    private ExternalIdentity rememberVerified(FourAClient.Profile profile) {
        var identity = identities.findLockedByIssuerAndExternalUserId(properties.issuer, profile.userId()).orElseGet(ExternalIdentity::new);
        identity.issuer = properties.issuer;
        identity.externalUserId = profile.userId();
        identity.username = profile.username();
        identity.displayName = profile.displayName();
        identity.externalGroupId = profile.groupId();
        identity.externalGroupName = profile.groupName();
        identity.externalRoleId = profile.roleId();
        identity.verifiedAt = Instant.now();
        return identities.saveAndFlush(identity);
    }

    /** The monitor covers the commit, so first login and administrator linking cannot create twice. */
    public ExternalIdentity synchronize(FourAClient.Profile profile) {
        return project(profile, true);
    }

    /** Only server-verified directory profiles may be linked; linking grants no business access. */
    public ExternalIdentity linkVerified(FourAClient.Profile profile) {
        return project(profile, false);
    }

    private ExternalIdentity project(FourAClient.Profile profile, boolean allowAdministratorBootstrap) {
        synchronized (projectionMonitor) {
            return projectionTransaction.execute(status -> projectVerified(profile, allowAdministratorBootstrap));
        }
    }

    private ExternalIdentity projectVerified(FourAClient.Profile profile, boolean allowAdministratorBootstrap) {
        var identity = rememberVerified(profile);
        UserAccount user;
        if (identity.userId == null) {
            user = new UserAccount();
            // This internal principal never depends on an editable upstream username. In particular,
            // a same-named local administrator cannot be claimed by a new external identity.
            user.username = "4a_" + identity.id.replace("-", "");
            user.passwordHash = "!4A-managed-no-local-password";
            identity.userId = user.id;
        } else {
            user = users.findLockedById(identity.userId).orElseThrow(FourAClient::expired);
        }
        user.displayName = limit(profile.displayName().isBlank() ? profile.username() : profile.displayName(), 100);
        if (user.role == null) {
            user.role = Role.DEPARTMENT;
            user.organizationId = stableId("unassigned-user", profile.userId());
            user.provenance = "{\"origin\":\"FOUR_A\",\"description\":\"由4A已验证身份建立的业务档案\"}";
            identity.businessAccessAssigned = false;
        }
        if (allowAdministratorBootstrap && !identity.businessAccessAssigned && !initialAdministratorId.isEmpty()
                && initialAdministratorId.equals(profile.userId())) {
            user.role = Role.ADMIN;
            user.organizationId = administrationOrganization();
            identity.businessAccessAssigned = true;
        }
        // Existing business UUIDs, roles, organizations, devices and regions are independent of 4A.
        users.saveAndFlush(user);
        return identities.saveAndFlush(identity);
    }

    private String stableId(String kind, String externalId) {
        return UUID.nameUUIDFromBytes((properties.issuer + "\u0000" + kind + "\u0000" + externalId)
                .getBytes(StandardCharsets.UTF_8)).toString();
    }
    private String administrationOrganization() {
        String id = stableId("local-platform-administration", "oneflight");
        if (!organizations.existsById(id)) {
            var organization = new Organization();
            organization.id = id; organization.organizationId = id;
            organization.title = "一网统飞平台管理"; organization.status = "ACTIVE";
            organization.provenance = "{\"origin\":\"BUSINESS_INITIALIZATION\",\"description\":\"显式配置的首位平台管理员所属本地组织\"}";
            organizations.saveAndFlush(organization);
        }
        return id;
    }
    private static String limit(String value, int max) { return value.substring(0, Math.min(value.length(), max)); }

    public CurrentUser currentView(UserAccount user) {
        var local = user.current();
        var identity = identities.findByUserId(user.id).filter(i -> properties.issuer.equals(i.issuer));
        if (!properties.isFourA() || identity.isEmpty()) return local;
        var external = identity.orElseThrow();
        return new CurrentUser(local.id(), external.username, external.displayName, local.role(), local.organizationId(),
                local.regions(), local.deviceIds(), local.organizationIds(), external.businessAccessAssigned);
    }
    public Map<String, Object> userView(UserAccount user) {
        Map<String, Object> row = user.view();
        var identity = identities.findByUserId(user.id).filter(i -> properties.issuer.equals(i.issuer));
        if (identity.isPresent()) {
            var external = identity.orElseThrow();
            row.put("username", external.username);
            row.put("displayName", external.displayName);
            row.put("title", external.displayName);
            row.put("identitySource", "4a");
            row.put("externalUserId", external.externalUserId);
            row.put("businessAccessAssigned", external.businessAccessAssigned);
        } else {
            row.put("identitySource", "local");
            row.put("businessAccessAssigned", true);
        }
        return row;
    }
    public boolean isFourAAccount(String userId) {
        return identities.findByUserId(userId).filter(i -> properties.issuer.equals(i.issuer)).isPresent();
    }
    @Transactional
    public void grantBusinessAccess(String userId) {
        identities.findByUserId(userId).filter(i -> properties.issuer.equals(i.issuer)).ifPresent(identity -> {
            identity.businessAccessAssigned = true;
            identities.saveAndFlush(identity);
        });
    }

    /** Compatibility for explicitly requested maintenance in local mode; disabled in 4A mode. */
    @Transactional
    public void bind(String identityId, String userId) {
        if (properties.isFourA()) throw managedAccounts();
        var identity = identities.findLockedById(identityId).orElseThrow(ApiException::missing);
        if (!properties.issuer.equals(identity.issuer)) throw ApiException.invalid("只能绑定当前 4A 服务验证的身份");
        if (userId != null) {
            users.findLockedById(userId).filter(u -> u.enabled).orElseThrow(() -> ApiException.invalid("请选择已启用的本地账号"));
            identities.findByUserId(userId).filter(i -> !i.id.equals(identityId)).ifPresent(i -> { throw ApiException.invalid("该本地账号已有 4A 绑定，请先解绑"); });
        }
        identity.userId = userId;
        identity.businessAccessAssigned = userId != null;
        identity.bindingRevision = UUID.randomUUID().toString();
        identities.saveAndFlush(identity);
    }
    public boolean hasAdministratorBinding() {
        return identities.findAll().stream().filter(i -> properties.issuer.equals(i.issuer) && i.userId != null)
                .anyMatch(i -> users.findById(i.userId).filter(u -> u.enabled && u.role == Role.ADMIN).isPresent());
    }
    public static ApiException managedAccounts() {
        return new ApiException(org.springframework.http.HttpStatus.FORBIDDEN, "FOUR_A_MANAGED_ACCOUNTS", "账号和身份由 4A 统一管理，无需在平台手工绑定");
    }
    public List<Map<String, Object>> views() {
        return identities.findAll().stream().filter(i -> properties.issuer.equals(i.issuer))
                .sorted(Comparator.comparing((ExternalIdentity i) -> i.verifiedAt).reversed()).map(i -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", i.id); row.put("issuer", i.issuer); row.put("externalUserId", i.externalUserId);
                    row.put("username", i.username); row.put("displayName", i.displayName); row.put("userId", i.userId);
                    row.put("externalGroupId", i.externalGroupId); row.put("externalGroupName", i.externalGroupName);
                    row.put("externalRoleId", i.externalRoleId); row.put("identitySource", "4a");
                    row.put("businessAccessAssigned", i.businessAccessAssigned);
                    row.put("linked", i.userId != null); row.put("verifiedAt", i.verifiedAt); return row;
                }).toList();
    }
}
