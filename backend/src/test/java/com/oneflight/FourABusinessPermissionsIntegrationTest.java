package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.FourAClient;
import com.oneflight.auth.FourAIdentityService;
import com.oneflight.auth.Role;
import com.oneflight.domain.ExternalIdentity;
import com.oneflight.domain.Organization;
import com.oneflight.domain.UserAccount;
import com.oneflight.integration.FourAAccountDirectory;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.ExternalIdentityRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.UserAccountRepository;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "oneflight.auth.mode=4a",
        "oneflight.auth.parent-origin=https://platform.example.test",
        "oneflight.auth.bootstrap-four-a-user-id=prelinked-bootstrap",
        "spring.datasource.url=jdbc:h2:mem:four-a-business-permissions;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "oneflight.sources.identity-jdbc-url="
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FourABusinessPermissionsIntegrationTest {
    private static final String ISSUER = "https://identity.example.test";
    private final ObjectMapper json = new ObjectMapper();
    @Autowired MockMvc mvc;
    @Autowired UserAccountRepository users;
    @Autowired ExternalIdentityRepository identities;
    @Autowired OrganizationRepository organizations;
    @Autowired AuditEventRepository events;
    @Autowired FourAIdentityService projections;
    @MockitoBean FourAClient client;
    @MockitoBean FourAAccountDirectory directory;
    UserAccount admin;
    UserAccount operator;
    ExternalIdentity operatorIdentity;
    Organization originalOrganization;
    Organization assignedOrganization;
    MockHttpSession adminSession;
    MockHttpSession operatorSession;

    @BeforeEach
    void fixtures() throws Exception {
        reset(client, directory);
        originalOrganization = organization("原业务组织");
        assignedOrganization = organization("新业务组织");
        admin = account(Role.ADMIN);
        operator = account(Role.DEPARTMENT);
        remember("immutable-admin", "actual-4a-admin", admin);
        operatorIdentity = remember("immutable-operator", "actual-4a-operator", operator);
        when(client.verify("admin-token", "oneflight")).thenReturn(
                new FourAClient.Profile("immutable-admin", "actual-4a-admin", "4A管理员", "external-group", "4A组织", "external-admin-role"));
        when(client.verify("operator-token", "oneflight")).thenReturn(
                new FourAClient.Profile("immutable-operator", "actual-4a-operator", "4A操作员", "external-group", "4A组织", "external-role"));
        adminSession = login("admin-token");
        operatorSession = login("operator-token");
        clearInvocations(client);
    }

    @AfterEach
    void cleanup() {
        SecurityContextHolder.clearContext();
        events.deleteAll();
        identities.deleteAll();
        users.deleteAll();
        organizations.deleteAll();
    }

    @Test
    void administratorConfiguresBusinessGrantsWithoutChangingTheVerifiedIdentityOrHistoricalUserId() throws Exception {
        String historicalId = operator.id;
        String internalPrincipal = users.findById(historicalId).orElseThrow().username;
        String identityId = operatorIdentity.id;
        String revision = operatorIdentity.bindingRevision;

        mvc.perform(put("/api/v1/users/{id}/permissions", historicalId)
                        .session(adminSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.DISPATCH, true)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(historicalId))
                .andExpect(jsonPath("$.data.username").value("actual-4a-operator"))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(true));

        UserAccount changed = users.findById(historicalId).orElseThrow();
        assertThat(changed.id).isEqualTo(historicalId);
        assertThat(changed.username).isEqualTo(internalPrincipal);
        assertThat(changed.role).isEqualTo(Role.DISPATCH);
        assertThat(changed.organizationId).isEqualTo(assignedOrganization.id);
        assertThat(UserAccount.split(changed.regions)).containsExactlyInAnyOrder("杭州市", "宁波市");
        assertThat(UserAccount.split(changed.deviceIds)).containsExactlyInAnyOrder("source-device-1", "source-device-2");
        assertThat(UserAccount.split(changed.organizationIds)).containsExactly(originalOrganization.id);
        assertThat(changed.enabled).isTrue();
        ExternalIdentity unchanged = identities.findById(identityId).orElseThrow();
        assertThat(unchanged.issuer).isEqualTo(ISSUER);
        assertThat(unchanged.externalUserId).isEqualTo("immutable-operator");
        assertThat(unchanged.username).isEqualTo("actual-4a-operator");
        assertThat(unchanged.userId).isEqualTo(historicalId);
        assertThat(unchanged.bindingRevision).isEqualTo(revision);

        mvc.perform(get("/api/v1/auth/me").session(operatorSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(historicalId))
                .andExpect(jsonPath("$.data.username").value("actual-4a-operator"))
                .andExpect(jsonPath("$.data.role").value("DISPATCH"))
                .andExpect(jsonPath("$.data.organizationId").value(assignedOrganization.id));
        verifyNoInteractions(client);
    }

    @Test
    void permissionsRequireAnAdministratorAndCsrf() throws Exception {
        mvc.perform(put("/api/v1/users/{id}/permissions", operator.id)
                        .session(operatorSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.ADMIN, true)))
                .andExpect(status().isForbidden());
        mvc.perform(put("/api/v1/users/{id}/permissions", operator.id)
                        .session(adminSession).contentType("application/json")
                        .content(permissions(Role.ADMIN, true)))
                .andExpect(status().isForbidden());
        assertThat(users.findById(operator.id).orElseThrow().role).isEqualTo(Role.DEPARTMENT);
        verifyNoInteractions(client);
    }

    @Test
    void fourAModeRejectsLocalIdentityCreationAndUsernameOrPasswordEdits() throws Exception {
        String originalPrincipal = users.findById(operator.id).orElseThrow().username;
        String originalPassword = users.findById(operator.id).orElseThrow().passwordHash;
        long originalCount = users.count();
        String payload = json.writeValueAsString(Map.of(
                "username", "replacement-local-account", "password", "replacementPassword123!",
                "displayName", "试图修改身份", "role", "ADMIN", "organizationId", originalOrganization.id));
        mvc.perform(post("/api/v1/users").session(adminSession).with(csrf())
                        .contentType("application/json").content(payload))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("IDENTITY_MANAGED_BY_4A"));
        mvc.perform(put("/api/v1/users/{id}", operator.id).session(adminSession).with(csrf())
                        .contentType("application/json").content(payload))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("IDENTITY_MANAGED_BY_4A"));
        assertThat(users.count()).isEqualTo(originalCount);
        UserAccount unchanged = users.findById(operator.id).orElseThrow();
        assertThat(unchanged.username).isEqualTo(originalPrincipal);
        assertThat(unchanged.passwordHash).isEqualTo(originalPassword);
        assertThat(identities.findById(operatorIdentity.id).orElseThrow().username).isEqualTo("actual-4a-operator");
        verifyNoInteractions(client);
    }

    @Test
    void accountListUsesTheActualFourAUsernameAndOmitsInternalPasswordFields() throws Exception {
        mvc.perform(get("/api/v1/users").param("query", "actual-4a-operator").session(adminSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].id").value(operator.id))
                .andExpect(jsonPath("$.data.items[0].username").value("actual-4a-operator"))
                .andExpect(jsonPath("$.data.items[0].externalUserId").value("immutable-operator"))
                .andExpect(jsonPath("$.data.items[0].identitySource").value("4a"))
                .andExpect(jsonPath("$.data.items[0].password").doesNotExist())
                .andExpect(jsonPath("$.data.items[0].passwordHash").doesNotExist());
        verifyNoInteractions(client);
    }

    @Test
    void newlyVerifiedIdentityHasNoBusinessAccessUntilAdministratorAssignsIt() throws Exception {
        when(client.verify("new-user-token", "oneflight")).thenReturn(
                new FourAClient.Profile("new-immutable-id", "new-4a-user", "新4A用户", "upstream-group", "上游组织", "upstream-admin-role"));
        MockHttpSession freshSession = login("new-user-token");
        ExternalIdentity freshIdentity = identities.findByIssuerAndExternalUserId(ISSUER, "new-immutable-id").orElseThrow();
        String historicalId = freshIdentity.userId;
        assertThat(freshIdentity.businessAccessAssigned).isFalse();
        assertThat(users.findById(historicalId).orElseThrow().role).isEqualTo(Role.DEPARTMENT);
        clearInvocations(client);

        mvc.perform(get("/api/v1/auth/me").session(freshSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("new-4a-user"))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(false));
        mvc.perform(get("/api/v1/users").session(freshSession))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLATFORM_ACCESS_PENDING"));
        mvc.perform(put("/api/v1/users/{id}/permissions", historicalId)
                        .session(adminSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.DISPATCH, true)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(true));
        mvc.perform(get("/api/v1/auth/me").session(freshSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(historicalId))
                .andExpect(jsonPath("$.data.username").value("new-4a-user"))
                .andExpect(jsonPath("$.data.role").value("DISPATCH"))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(true));
        mvc.perform(get("/api/v1/users").session(freshSession)).andExpect(status().isOk());
        assertThat(identities.findById(freshIdentity.id).orElseThrow().externalUserId).isEqualTo("new-immutable-id");
        verifyNoInteractions(client);
    }

    @Test
    void refreshedFourAOrganizationAndRoleMetadataDoNotOverwriteLocalBusinessPermissions() throws Exception {
        mvc.perform(put("/api/v1/users/{id}/permissions", operator.id)
                        .session(adminSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.DISPATCH, true)))
                .andExpect(status().isOk());
        projections.synchronize(new FourAClient.Profile("immutable-operator", "renamed-4a-user", "改名用户",
                "different-external-group", "新的4A组织", "different-external-admin-role"));
        UserAccount unchanged = users.findById(operator.id).orElseThrow();
        assertThat(unchanged.role).isEqualTo(Role.DISPATCH);
        assertThat(unchanged.organizationId).isEqualTo(assignedOrganization.id);
        assertThat(UserAccount.split(unchanged.regions)).containsExactlyInAnyOrder("杭州市", "宁波市");
        assertThat(UserAccount.split(unchanged.deviceIds)).containsExactlyInAnyOrder("source-device-1", "source-device-2");
        assertThat(UserAccount.split(unchanged.organizationIds)).containsExactly(originalOrganization.id);
        mvc.perform(get("/api/v1/auth/me").session(operatorSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(operator.id))
                .andExpect(jsonPath("$.data.username").value("renamed-4a-user"))
                .andExpect(jsonPath("$.data.role").value("DISPATCH"));
        verifyNoInteractions(client);
    }

    @Test
    void disablingBusinessAccountRevokesItsSessionWithoutChangingFourAIdentity() throws Exception {
        mvc.perform(put("/api/v1/users/{id}/permissions", operator.id)
                        .session(adminSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.DEPARTMENT, false)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.enabled").value(false));
        assertThat(users.findById(operator.id).orElseThrow().enabled).isFalse();
        mvc.perform(get("/api/v1/auth/me").session(operatorSession)).andExpect(status().isUnauthorized());
        assertThat(operatorSession.isInvalid()).isTrue();
        ExternalIdentity unchanged = identities.findById(operatorIdentity.id).orElseThrow();
        assertThat(unchanged.externalUserId).isEqualTo("immutable-operator");
        assertThat(unchanged.username).isEqualTo("actual-4a-operator");
        verifyNoInteractions(client);
    }

    @Test
    void administratorCannotDisableOrDowngradeTheCurrentBusinessAdministrator() throws Exception {
        mvc.perform(put("/api/v1/users/{id}/permissions", admin.id)
                        .session(adminSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.DEPARTMENT, true)))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/v1/users/{id}/permissions", admin.id)
                        .session(adminSession).with(csrf()).contentType("application/json")
                        .content(permissions(Role.ADMIN, false)))
                .andExpect(status().isBadRequest());
        UserAccount unchanged = users.findById(admin.id).orElseThrow();
        assertThat(unchanged.role).isEqualTo(Role.ADMIN);
        assertThat(unchanged.enabled).isTrue();
        verifyNoInteractions(client);
    }

    @Test
    void administratorLinksARealDirectoryAccountBeforeItsFirstLoginAndAssignsLocalPermissions() throws Exception {
        var profile = new FourAClient.Profile("unlogged-external-id", "unlogged-user", "未登录飞手", "4a-group", "4A组织", "");
        when(directory.requireAvailable(profile.userId())).thenReturn(profile);
        when(directory.search(1, 20, "未登录")).thenReturn(new PageResult<>(List.of(
                new FourAAccountDirectory.Account(profile.userId(), profile.username(), profile.displayName(), profile.groupId(), profile.groupName(), true, "")), 1, 1, 20));

        mvc.perform(get("/api/v1/users/4a-directory").param("query", "未登录").session(adminSession))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.items[0].linked").value(false))
                .andExpect(jsonPath("$.data.items[0].externalUserId").value(profile.userId()));
        long count = users.count();
        String linkedResponse = mvc.perform(post("/api/v1/users/4a-link").session(adminSession).with(csrf())
                        .contentType("application/json").content(json.writeValueAsString(Map.of("externalUserId", profile.userId(),
                                "username", "spoofed-admin", "role", "ADMIN", "organizationId", assignedOrganization.id))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.username").value(profile.username()))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(false))
                .andExpect(jsonPath("$.data.role").value("DEPARTMENT"))
                .andReturn().getResponse().getContentAsString();
        String userId = json.readTree(linkedResponse).path("data").path("id").asText();
        assertThat(users.count()).isEqualTo(count + 1);
        mvc.perform(put("/api/v1/users/{id}/permissions", userId).session(adminSession).with(csrf())
                        .contentType("application/json").content(permissions(Role.PILOT, true)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.businessAccessAssigned").value(true));
        mvc.perform(get("/api/v1/users/4a-directory").param("query", "未登录").session(adminSession))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.items[0].linked").value(true))
                .andExpect(jsonPath("$.data.items[0].userId").value(userId));
        mvc.perform(post("/api/v1/users/4a-link").session(adminSession).with(csrf())
                        .contentType("application/json").content(json.writeValueAsString(Map.of("externalUserId", profile.userId()))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value(userId))
                .andExpect(jsonPath("$.data.role").value("PILOT"));
        when(client.verify("unlogged-user-token", "oneflight")).thenReturn(new FourAClient.Profile(profile.userId(), "renamed-after-link", "改名后飞手"));
        MockHttpSession firstSession = login("unlogged-user-token");
        mvc.perform(get("/api/v1/auth/me").session(firstSession))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.id").value(userId))
                .andExpect(jsonPath("$.data.role").value("PILOT"))
                .andExpect(jsonPath("$.data.username").value("renamed-after-link"))
                .andExpect(jsonPath("$.data.organizationId").value(assignedOrganization.id));
        var account = users.findById(userId).orElseThrow();
        assertThat(UserAccount.split(account.deviceIds)).containsExactlyInAnyOrder("source-device-1", "source-device-2");
        assertThat(users.count()).isEqualTo(count + 1);
        verify(directory, times(2)).requireAvailable(profile.userId());
    }

    @Test
    void directoryAndLinkRequireAdministratorAndCsrfAndSourceVerification() throws Exception {
        String payload = "{\"externalUserId\":\"missing-source-user\"}";
        mvc.perform(get("/api/v1/users/4a-directory").session(operatorSession)).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/users/4a-link").session(operatorSession).with(csrf())
                        .contentType("application/json").content(payload)).andExpect(status().isForbidden());
        mvc.perform(post("/api/v1/users/4a-link").session(adminSession)
                        .contentType("application/json").content(payload)).andExpect(status().isForbidden());
        verifyNoInteractions(directory);
        long count = users.count();
        when(directory.requireAvailable("missing-source-user")).thenThrow(ApiException.missing());
        mvc.perform(post("/api/v1/users/4a-link").session(adminSession).with(csrf())
                        .contentType("application/json").content(payload)).andExpect(status().isNotFound());
        assertThat(users.count()).isEqualTo(count);
    }

    @Test
    void prelinkingNeverGrantsBootstrapAdministratorAndPreservesDisabledBusinessAccount() throws Exception {
        var profile = new FourAClient.Profile("prelinked-bootstrap", "bootstrap-upstream-user", "预关联账号");
        var created = projections.linkVerified(profile);
        assertThat(created.businessAccessAssigned).isFalse();
        assertThat(users.findById(created.userId).orElseThrow().role).isEqualTo(Role.DEPARTMENT);
        UserAccount existing = users.findById(operator.id).orElseThrow();
        existing.enabled = false;
        existing.organizationIds = assignedOrganization.id;
        users.saveAndFlush(existing);
        var linked = projections.linkVerified(new FourAClient.Profile(operatorIdentity.externalUserId, "updated-name", "新姓名"));
        assertThat(linked.userId).isEqualTo(operator.id);
        assertThat(linked.businessAccessAssigned).isTrue();
        var unchanged = users.findById(operator.id).orElseThrow();
        assertThat(unchanged.enabled).isFalse();
        assertThat(unchanged.role).isEqualTo(Role.DEPARTMENT);
        assertThat(unchanged.organizationId).isEqualTo(originalOrganization.id);
        assertThat(unchanged.organizationIds).isEqualTo(assignedOrganization.id);
        assertThat(unchanged.deviceIds).isEqualTo("original-device");
    }

    @Test
    void concurrentFirstLoginAndPrelinkReuseOneIdentityAndOneBusinessAccount() throws Exception {
        var profile = new FourAClient.Profile("concurrent-external-user", "concurrent-user", "并发关联用户");
        var start = new CountDownLatch(1);
        long count = users.count();
        try (var executor = Executors.newFixedThreadPool(2)) {
            var linked = executor.submit(() -> { start.await(); return projections.linkVerified(profile); });
            var loggedIn = executor.submit(() -> { start.await(); return projections.synchronize(profile); });
            start.countDown();
            assertThat(linked.get(10, TimeUnit.SECONDS).userId).isEqualTo(loggedIn.get(10, TimeUnit.SECONDS).userId);
        }
        assertThat(users.count()).isEqualTo(count + 1);
        assertThat(identities.findByIssuerAndExternalUserId(ISSUER, profile.userId()).orElseThrow().businessAccessAssigned).isFalse();
    }

    private Organization organization(String title) {
        Organization organization = new Organization();
        organization.title = title;
        organization.status = "ACTIVE";
        organization.organizationId = organization.id;
        return organizations.saveAndFlush(organization);
    }

    private UserAccount account(Role role) {
        UserAccount user = new UserAccount();
        user.username = "legacy-business-" + UUID.randomUUID();
        user.passwordHash = "original-legacy-hash";
        user.displayName = "原业务用户";
        user.role = role;
        user.organizationId = originalOrganization.id;
        user.deviceIds = "original-device";
        user.regions = "原区域";
        return users.saveAndFlush(user);
    }

    private ExternalIdentity remember(String immutableId, String username, UserAccount account) {
        ExternalIdentity identity = projections.remember(new FourAClient.Profile(immutableId, username, username));
        identity.userId = account.id;
        identity.businessAccessAssigned = true;
        return identities.saveAndFlush(identity);
    }

    private String permissions(Role role, boolean enabled) throws Exception {
        return json.writeValueAsString(Map.of("role", role.name(), "organizationId", assignedOrganization.id,
                "regions", Set.of("杭州市", "宁波市"), "deviceIds", Set.of("source-device-1", "source-device-2"),
                "organizationIds", Set.of(originalOrganization.id), "enabled", enabled));
    }

    private MockHttpSession login(String token) throws Exception {
        MockHttpSession previous = new MockHttpSession();
        String redirect = mvc.perform(get("/api/v1/auth/4a/start").session(previous))
                .andExpect(status().isFound()).andReturn().getResponse().getRedirectedUrl();
        assertThat(redirect).startsWith(ISSUER + "/login?systemName=oneflight&fallback=");
        String fallback = URLDecoder.decode(redirect.substring(redirect.indexOf("fallback=") + 9), StandardCharsets.UTF_8);
        String state = URI.create(fallback).getQuery().substring("state=".length());
        var result = mvc.perform(get("/api/v1/auth/4a/callback").session(previous)
                        .param("state", state).param("token", token))
                .andExpect(status().isFound()).andExpect(redirectedUrl("https://platform.example.test/"))
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }
}
