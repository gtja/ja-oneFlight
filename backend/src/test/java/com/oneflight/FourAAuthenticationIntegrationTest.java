package com.oneflight;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;

import com.oneflight.auth.*;
import com.oneflight.common.ApiException;
import com.oneflight.domain.*;
import com.oneflight.repository.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@SpringBootTest(properties = {"oneflight.auth.mode=4a", "oneflight.auth.parent-origin=https://platform.example.test",
        "oneflight.auth.bootstrap-four-a-user-id=explicit-first-admin"})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class FourAAuthenticationIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired UserAccountRepository users;
    @Autowired ExternalIdentityRepository identities;
    @Autowired FourAIdentityService identityService;
    @Autowired FourASessionService sessions;
    @MockitoBean FourAClient client;
    UserAccount admin;
    UserAccount pilot;
    ExternalIdentity adminIdentity;
    ExternalIdentity pilotIdentity;

    @BeforeEach void fixtures() {
        reset(client);
        identities.deleteAll();
        admin = account(Role.ADMIN);
        pilot = account(Role.PILOT);
        adminIdentity = remember("4a-admin", admin.id);
        pilotIdentity = remember("4a-pilot", pilot.id);
        when(client.verify("pilot-token", "oneflight")).thenReturn(new FourAClient.Profile("4a-pilot", "upstream-name", "飞手"));
        when(client.verify("admin-token", "oneflight")).thenReturn(new FourAClient.Profile("4a-admin", "external-admin", "管理员"));
        when(client.logout(anyString())).thenReturn(true);
    }
    @AfterEach void cleanup() {
        identities.deleteAll(); users.deleteById(admin.id); users.deleteById(pilot.id); SecurityContextHolder.clearContext();
    }
    UserAccount account(Role role) {
        var u = new UserAccount(); u.username = "sso-test-" + UUID.randomUUID(); u.displayName = "本地账号";
        u.passwordHash = "unused"; u.role = role; u.organizationId = UUID.randomUUID().toString();
        u.deviceIds = "local-device"; u.regions = "杭州市"; return users.saveAndFlush(u);
    }
    ExternalIdentity remember(String external, String local) {
        var i = identityService.remember(new FourAClient.Profile(external, external, external));
        i.userId = local; i.businessAccessAssigned = true; return identities.saveAndFlush(i);
    }
    String begin(MockHttpSession session) throws Exception {
        String redirect = mvc.perform(get("/api/v1/auth/4a/start").session(session)).andExpect(status().isFound()).andReturn().getResponse().getRedirectedUrl();
        assertThat(redirect).startsWith("https://identity.example.test/login?systemName=oneflight&fallback=");
        String fallback = URLDecoder.decode(redirect.substring(redirect.indexOf("fallback=") + 9), StandardCharsets.UTF_8);
        assertThat(fallback).startsWith("https://platform.example.test/api/v1/auth/4a/callback?state=");
        return URI.create(fallback).getQuery().substring(6);
    }
    MockHttpSession login(String token) throws Exception {
        MockHttpSession before = new MockHttpSession(); String state = begin(before);
        var result = mvc.perform(get("/api/v1/auth/4a/callback").session(before).param("state", state).param("token", token))
                .andExpect(status().isFound()).andExpect(redirectedUrl("https://platform.example.test/"))
                .andExpect(header().string("Referrer-Policy", "no-referrer")).andReturn();
        assertThat(before.isInvalid()).isTrue();
        assertThat(result.getResponse().getRedirectedUrl()).doesNotContain(token);
        return (MockHttpSession) result.getRequest().getSession(false);
    }
    @Test void callbackPreservesLocalBusinessIdentityAndGrants() throws Exception {
        String oldPassword = pilot.passwordHash;
        var session = login("pilot-token");
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(pilot.id)).andExpect(jsonPath("$.data.role").value("PILOT"))
                .andExpect(jsonPath("$.data.deviceIds[0]").value("local-device"))
                .andExpect(jsonPath("$.data.username").value("upstream-name"))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(true));
        assertThat(sessions.requirePlatformIdentity(session).token()).isEqualTo("pilot-token");
        assertThat(identities.findById(pilotIdentity.id).orElseThrow().username).isEqualTo("upstream-name");
        var unchanged = users.findById(pilot.id).orElseThrow();
        assertThat(unchanged.passwordHash).isEqualTo(oldPassword);
        assertThat(unchanged.organizationId).isEqualTo(pilot.organizationId);
    }
    @Test void renamedExternalUsernameKeepsTheSameBusinessUuidAndPermissions() throws Exception {
        login("pilot-token");
        when(client.verify("pilot-token", "oneflight")).thenReturn(new FourAClient.Profile("4a-pilot", "renamed", "新的显示名",
                "external-new-org", "另一组织", "external-admin-role"));
        var session = login("pilot-token");
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(pilot.id)).andExpect(jsonPath("$.data.username").value("renamed"))
                .andExpect(jsonPath("$.data.role").value("PILOT")).andExpect(jsonPath("$.data.organizationId").value(pilot.organizationId))
                .andExpect(jsonPath("$.data.deviceIds[0]").value("local-device"));
        assertThat(users.findById(pilot.id).orElseThrow().username).isEqualTo(pilot.username);
    }
    @Test void firstLoginHasNoBusinessAccessButCanIndependentlyVerifyFlightPermission() throws Exception {
        var profile = new FourAClient.Profile("first-user", "4a-admin-named-person", "4A管理员", "4a-group", "4A组织", "1");
        when(client.verify("first-user-token", "oneflight")).thenReturn(profile);
        when(client.verify("first-user-token", "jingqi")).thenReturn(profile);
        var session = login("first-user-token");
        var identity = identities.findByIssuerAndExternalUserId("https://identity.example.test", "first-user").orElseThrow();
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("4a-admin-named-person"))
                .andExpect(jsonPath("$.data.role").value("DEPARTMENT"))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(false));
        mvc.perform(get("/api/v1/tasks").session(session)).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLATFORM_ACCESS_PENDING"));
        assertThat(sessions.requireFlightIdentity(session).immutableUserId()).isEqualTo("first-user");
        assertThat(session.isInvalid()).isFalse();
        var projection = users.findById(identity.userId).orElseThrow();
        assertThat(projection.role).isNotEqualTo(Role.ADMIN);
        assertThat(projection.organizationId).isNotEqualTo(pilot.organizationId);
        users.delete(projection);
    }
    @Test void onlyExplicitImmutableFirstAdministratorIdReceivesInitialLocalAdministration() throws Exception {
        when(client.verify("first-admin-token", "oneflight")).thenReturn(new FourAClient.Profile("explicit-first-admin", "any-name", "本地首管理员"));
        var session = login("first-admin-token");
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.role").value("ADMIN"))
                .andExpect(jsonPath("$.data.businessAccessAssigned").value(true));
        var identity = identities.findByIssuerAndExternalUserId("https://identity.example.test", "explicit-first-admin").orElseThrow();
        users.deleteById(identity.userId);
    }
    @Test void stateIsRequiredBoundToSessionAndSingleUse() throws Exception {
        var session = new MockHttpSession(); String state = begin(session);
        mvc.perform(get("/api/v1/auth/4a/callback").session(new MockHttpSession()).param("state", state).param("token", "pilot-token"))
                .andExpect(redirectedUrl("https://platform.example.test/?authError=INVALID_STATE"));
        mvc.perform(get("/api/v1/auth/4a/callback").session(session).param("state", "forged").param("token", "pilot-token"))
                .andExpect(redirectedUrl("https://platform.example.test/?authError=INVALID_STATE"));
        mvc.perform(get("/api/v1/auth/4a/callback").session(session).param("state", state).param("token", "pilot-token"))
                .andExpect(redirectedUrl("https://platform.example.test/?authError=INVALID_STATE"));
        verifyNoInteractions(client);
    }
    @Test void unboundIdentityCannotClaimSameNamedLocalAccount() throws Exception {
        when(client.verify("unbound", "oneflight")).thenReturn(new FourAClient.Profile("new-immutable-id", pilot.username, "同名人员"));
        var session = new MockHttpSession(); String state = begin(session);
        mvc.perform(get("/api/v1/auth/4a/callback").session(session).param("state", state).param("token", "unbound"))
                .andExpect(redirectedUrl("https://platform.example.test/"));
        var pending = identities.findByIssuerAndExternalUserId("https://identity.example.test", "new-immutable-id").orElseThrow();
        assertThat(pending.userId).isNotNull().isNotEqualTo(pilot.id);
        assertThat(pending.businessAccessAssigned).isFalse();
        var projection = users.findById(pending.userId).orElseThrow();
        assertThat(projection.role).isEqualTo(Role.DEPARTMENT);
        assertThat(projection.username).isNotEqualTo(pilot.username);
        assertThat(projection.passwordHash).startsWith("!4A-managed");
        assertThat(session.isInvalid()).isTrue();
        users.delete(projection);
    }
    @Test void disabledAccountCannotSignInOrReuseExistingSession() throws Exception {
        var session = login("pilot-token"); pilot.enabled = false; users.saveAndFlush(pilot);
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isUnauthorized());
        assertThat(session.isInvalid()).isTrue();
        var next = new MockHttpSession(); String state = begin(next);
        mvc.perform(get("/api/v1/auth/4a/callback").session(next).param("state", state).param("token", "pilot-token"))
                .andExpect(redirectedUrl("https://platform.example.test/?authError=ACCOUNT_DISABLED"));
    }
    @Test void missingFlightPermissionDoesNotInvalidatePlatformSession() throws Exception {
        var session = login("pilot-token");
        when(client.verify("pilot-token", "jingqi")).thenThrow(new ApiException(HttpStatus.FORBIDDEN, "FLIGHT_PERMISSION_DENIED", "无飞控权限"));
        assertThatThrownBy(() -> sessions.requireFlightIdentity(session)).isInstanceOf(ApiException.class).hasMessage("无飞控权限");
        assertThat(session.isInvalid()).isFalse();
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isOk());
    }
    @Test void changedBindingRejectsOldSessionEvenIfReboundToSameAccount() throws Exception {
        var session = login("pilot-token");
        var changed = identities.findById(pilotIdentity.id).orElseThrow();
        changed.bindingRevision = UUID.randomUUID().toString(); identities.saveAndFlush(changed);
        mvc.perform(get("/api/v1/auth/me").session(session)).andExpect(status().isUnauthorized());
        assertThat(session.isInvalid()).isTrue();
    }
    @Test void platformTokenExpiryAtFlightLaunchInvalidatesParentSession() throws Exception {
        var session = login("pilot-token"); when(client.verify("pilot-token", "oneflight")).thenThrow(FourAClient.expired());
        assertThatThrownBy(() -> sessions.requireFlightIdentity(session)).isInstanceOf(ApiException.class);
        assertThat(session.isInvalid()).isTrue();
    }
    @Test void revokedFourABindingAtFlightLaunchStillInvalidatesRatherThanDowngradingToLocalLogin() throws Exception {
        var session = login("pilot-token");
        session.setAttribute(FourASessionService.LOCAL_MAINTENANCE, true);
        var removed = identities.findById(pilotIdentity.id).orElseThrow(); removed.userId = null; identities.saveAndFlush(removed);
        assertThatThrownBy(() -> sessions.requireFlightIdentity(session)).isInstanceOfSatisfying(ApiException.class, error -> {
            assertThat(error.getStatus()).isEqualTo(HttpStatus.UNAUTHORIZED);
            assertThat(error.getCode()).isEqualTo("FOUR_A_SESSION_EXPIRED");
        });
        assertThat(session.isInvalid()).isTrue();
    }
    @Test void accountRevokedDuringFlightVerificationCannotReceiveToken() throws Exception {
        var session = login("pilot-token");
        when(client.verify("pilot-token", "jingqi")).thenAnswer(call -> {
            pilot.enabled = false; users.saveAndFlush(pilot);
            return new FourAClient.Profile("4a-pilot", "operator", "飞手");
        });
        assertThatThrownBy(() -> sessions.requireFlightIdentity(session)).isInstanceOf(ApiException.class);
        assertThat(session.isInvalid()).isTrue();
    }
    @Test void bindingManagementRequiresAdminAndCsrf() throws Exception {
        var session = login("pilot-token");
        mvc.perform(get("/api/v1/auth/4a/identities").session(session)).andExpect(status().isForbidden());
        var adminSession = login("admin-token");
        mvc.perform(get("/api/v1/auth/4a/identities").session(adminSession)).andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].externalUserId").exists()).andExpect(jsonPath("$.data[0].token").doesNotExist());
        mvc.perform(delete("/api/v1/auth/4a/identities/" + pilotIdentity.id + "/binding").session(adminSession)).andExpect(status().isForbidden());
        mvc.perform(delete("/api/v1/auth/4a/identities/" + pilotIdentity.id + "/binding").session(adminSession).with(csrf()))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FOUR_A_MANAGED_ACCOUNTS"));
        assertThat(identities.findById(pilotIdentity.id).orElseThrow().userId).isEqualTo(pilot.id);
    }
    @Test void localMaintenanceIsOffAndFirstAdministratorIsNotRequiredToAuthenticate() throws Exception {
        mvc.perform(get("/api/v1/auth/options")).andExpect(status().isOk()).andExpect(jsonPath("$.data.mode").value("4a"))
                .andExpect(jsonPath("$.data.localLoginEnabled").value(false));
        mvc.perform(post("/api/v1/auth/login").with(csrf()).contentType("application/json").content("{\"username\":\"admin\",\"password\":\"unused\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("LOCAL_LOGIN_DISABLED"));
        identities.delete(adminIdentity);
        mvc.perform(get("/api/v1/auth/4a/start")).andExpect(status().isFound())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("https://identity.example.test/login?systemName=oneflight&fallback=")));
    }
    @Test void externalLogoutFailureStillDestroysLocalIdentity() throws Exception {
        var session = login("pilot-token"); when(client.logout("pilot-token")).thenReturn(false);
        mvc.perform(post("/api/v1/auth/logout").session(session).with(csrf())).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.externalLogoutSucceeded").value(false));
        assertThat(session.isInvalid()).isTrue();
    }
}
