package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.FourAClient;
import com.oneflight.auth.FourAIdentityService;
import com.oneflight.auth.FourASessionService;
import com.oneflight.auth.Role;
import com.oneflight.domain.ExternalIdentity;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.integration.PersonalFlightDevices;
import com.oneflight.integration.SourceModels;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.ExternalIdentityRepository;
import com.oneflight.repository.FlightPlanRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(properties = {
        "oneflight.auth.mode=4a",
        "oneflight.auth.parent-origin=https://platform.example.test",
        "oneflight.auth.bootstrap-four-a-user-id=",
        "spring.datasource.url=jdbc:h2:mem:task-flight-entry;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
        "oneflight.sources.identity-jdbc-url=",
        "FLIGHT_CONTROL_MODE=embedded",
        "FLIGHT_CONTROL_ORIGIN=https://flight.example.test",
        "ONEFLIGHT_PUBLIC_ORIGIN=https://platform.example.test",
        "FLIGHT_CONTROL_GATEWAY_SECRET=abcdefghijklmnopqrstuvwxyz123456"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TaskFlightEntryIntegrationTest {
    private static final String SECRET = "abcdefghijklmnopqrstuvwxyz123456";
    private static final String TOKEN = "synthetic-personal-token";
    private static final String SOURCE_ID = "verified-source-uav";
    private static final String EXTERNAL_ID = "immutable-flight-entry-admin";
    private final ObjectMapper json = new ObjectMapper();
    @Autowired MockMvc mvc;
    @Autowired TaskRepository tasks;
    @Autowired FlightPlanRepository plans;
    @Autowired ResourceRepository resources;
    @Autowired UserAccountRepository users;
    @Autowired ExternalIdentityRepository identities;
    @Autowired OrganizationRepository organizations;
    @Autowired AuditEventRepository events;
    @Autowired FourAIdentityService projections;
    @Autowired FourASessionService sessions;
    @Autowired FlightEntryGrants grants;
    @MockitoBean FourAClient client;
    @MockitoBean PersonalFlightDevices personalDevices;
    private UserAccount admin;
    private UserAccount pilot;
    private ExternalIdentity binding;
    private Task task;
    private FlightPlan plan;
    private Resource device;
    private MockHttpSession session;

    @BeforeEach
    void fixture() {
        Organization organization = new Organization();
        organization.title = "入口验收组织";
        organization.organizationId = organization.id;
        organization.status = "ACTIVE";
        organizations.saveAndFlush(organization);
        admin = account("local-entry-admin", Role.ADMIN, organization.id);
        pilot = account("local-entry-pilot", Role.PILOT, organization.id);
        pilot.regions = "杭州";
        pilot.deviceIds = SOURCE_ID;
        users.saveAndFlush(pilot);
        FourAClient.Profile profile = new FourAClient.Profile(EXTERNAL_ID, "entry-admin", "入口管理员");
        binding = projections.remember(profile);
        binding.userId = admin.id;
        binding.businessAccessAssigned = true;
        identities.saveAndFlush(binding);
        when(client.verify(TOKEN, "oneflight")).thenReturn(profile);
        when(client.verify(TOKEN, "jingqi")).thenReturn(profile);
        when(personalDevices.require(TOKEN, SOURCE_ID)).thenReturn(new SourceModels.Device(
                SOURCE_ID, "dji", "来源航空器", "UAV", "serial", "upstream-org", null,
                null, null, "UNKNOWN", null, null));
        plan = new FlightPlan();
        plan.title = "已批日常计划";
        plan.kind = "DAILY";
        plan.status = "APPROVED";
        plan.organizationId = organization.id;
        plan.region = "杭州";
        plan.startAt = Instant.now().minusSeconds(3600);
        plan.endAt = Instant.now().plusSeconds(3600);
        plans.saveAndFlush(plan);
        device = new Resource();
        device.title = "执行设备";
        device.kind = "DEVICE";
        device.status = "ACTIVE";
        device.organizationId = organization.id;
        device.region = "杭州";
        device.sourceDeviceId = SOURCE_ID;
        resources.saveAndFlush(device);
        task = new Task();
        task.title = "入口验收任务";
        task.status = "PENDING_EXECUTION";
        task.organizationId = organization.id;
        task.region = "杭州";
        task.planId = plan.id;
        task.deviceId = device.id;
        task.pilotId = pilot.id;
        task.startAt = Instant.now().minusSeconds(120);
        task.endAt = Instant.now().plusSeconds(1200);
        tasks.saveAndFlush(task);
        session = new MockHttpSession();
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(admin.username, "N/A",
                List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
        session.setAttribute("SPRING_SECURITY_CONTEXT", context);
        sessions.establish(session, binding, TOKEN);
        SecurityContextHolder.clearContext();
    }

    @AfterEach
    void cleanup() {
        grants.revoke(session);
        SecurityContextHolder.clearContext();
        events.deleteAll();
        tasks.deleteAll();
        plans.deleteAll();
        resources.deleteAll();
        identities.deleteAll();
        users.deleteAll();
        organizations.deleteAll();
    }

    private UserAccount account(String username, Role role, String organizationId) {
        UserAccount user = new UserAccount();
        user.username = username;
        user.displayName = username;
        user.passwordHash = "!synthetic-no-local-password";
        user.role = role;
        user.organizationId = organizationId;
        return users.saveAndFlush(user);
    }

    private String launch() throws Exception {
        String body = mvc.perform(post("/api/v1/flight-control/launch").session(session).with(csrf())
                        .contentType("application/json").content(json.writeValueAsString(java.util.Map.of("taskId", task.id))))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain(TOKEN, "passwordHash");
        return json.readTree(body).path("data").path("url").asText().split("ticket=")[1];
    }

    @Test
    void chooserHidesExpiredWorkUnlessRequestedAndKeepsItsChecksAvailable() throws Exception {
        Task expired = new Task();
        expired.title = "历史执行任务"; expired.status = "PENDING_EXECUTION";
        expired.organizationId = task.organizationId; expired.region = task.region;
        expired.planId = plan.id; expired.deviceId = device.id; expired.pilotId = pilot.id;
        expired.startAt = Instant.now().minusSeconds(600); expired.endAt = Instant.now().minusSeconds(1);
        tasks.saveAndFlush(expired);
        mvc.perform(get("/api/v1/flight-control/tasks").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].taskId").value(task.id));
        mvc.perform(get("/api/v1/flight-control/tasks").session(session).param("includeExpired", "true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2))
                .andExpect(jsonPath("$.data.items[1].taskId").value(expired.id));
        mvc.perform(get("/api/v1/flight-control/preflight").session(session).param("taskId", expired.id))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.eligible").value(false));
    }

    private MvcResult bootstrap(String ticket) throws Exception {
        SecurityContextHolder.clearContext();
        return mvc.perform(get("/api/v1/flight-control/bootstrap").param("ticket", ticket)
                .header("X-Oneflight-Gateway-Secret", SECRET)).andReturn();
    }

    private String grantFrom(MvcResult result) {
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        String cookie = result.getResponse().getHeader("Set-Cookie");
        assertThat(cookie).contains("HttpOnly", "Path=/", "SameSite=Lax", "Secure");
        var matcher = Pattern.compile("ONEFLIGHT_ENTRY=([A-Za-z0-9_-]{43})(?:;|$)").matcher(cookie);
        assertThat(matcher.find()).isTrue();
        return matcher.group(1);
    }

    private void gateway(String grant, String kind, int expectedStatus) throws Exception {
        SecurityContextHolder.clearContext();
        mvc.perform(get("/api/v1/flight-control/gateway-check")
                        .header("X-Oneflight-Gateway-Secret", SECRET)
                        .header("X-Oneflight-Entry-Grant", grant)
                        .header("X-Oneflight-Request-Kind", kind))
                .andExpect(status().is(expectedStatus));
    }

    @Test
    void launchAndStatelessBootstrapUseTheTicketPrincipalWithTheActualPolicy() throws Exception {
        String ticket = launch();
        MvcResult result = bootstrap(ticket);
        String grant = grantFrom(result);
        assertThat(result.getRequest().getSession(false)).isNull();
        assertThat(result.getResponse().getContentAsString()).contains("/control-room/uav/" + SOURCE_ID);
        assertThat(tasks.findById(task.id).orElseThrow().status).isEqualTo("PENDING_EXECUTION");
        assertThat(grants.require(grant).localUserId()).isEqualTo(admin.id);
        gateway(grant, "entry", 204);
        gateway(grant, "continue", 204);
        assertThat(bootstrap(ticket).getResponse().getStatus()).isEqualTo(401);
        assertThat(events.findAll()).anyMatch(event -> "FLIGHT_ENTRY_GRANTED".equals(event.action));
        assertThat(events.findAll().stream().map(event -> event.view()).toList().toString())
                .doesNotContain(TOKEN, ticket, grant);
    }

    @ParameterizedTest
    @ValueSource(strings = {"TASK_VERSION", "PLAN_VERSION", "RESOURCE_VERSION", "ASSIGNMENT", "PILOT_GRANT", "CALLER_ROLE", "BUSINESS_ACCESS", "TIME"})
    void bootstrapRechecksChangesAfterTicketWasIssued(String change) throws Exception {
        String ticket = launch();
        switch (change) {
            case "TASK_VERSION" -> {
                task.title = "签票后改名";
                tasks.saveAndFlush(task);
            }
            case "PLAN_VERSION" -> {
                plan.title = "签票后改名";
                plans.saveAndFlush(plan);
            }
            case "RESOURCE_VERSION" -> {
                device.title = "签票后改名";
                resources.saveAndFlush(device);
            }
            case "ASSIGNMENT" -> {
                task.pilotId = null;
                tasks.saveAndFlush(task);
            }
            case "PILOT_GRANT" -> {
                pilot.deviceIds = "";
                users.saveAndFlush(pilot);
            }
            case "CALLER_ROLE" -> {
                admin = users.findById(admin.id).orElseThrow();
                admin.role = Role.DEPARTMENT;
                users.saveAndFlush(admin);
            }
            case "BUSINESS_ACCESS" -> {
                binding = identities.findById(binding.id).orElseThrow();
                binding.businessAccessAssigned = false;
                identities.saveAndFlush(binding);
            }
            case "TIME" -> {
                task.endAt = Instant.now().minusSeconds(1);
                tasks.saveAndFlush(task);
            }
            default -> throw new IllegalArgumentException(change);
        }
        MvcResult result = bootstrap(ticket);
        assertThat(result.getResponse().getStatus()).isEqualTo(401);
        assertThat(result.getResponse().getContentAsString()).doesNotContain(TOKEN);
        assertThat(result.getResponse().getHeader("Set-Cookie")).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"TIME", "TASK_STARTED", "PILOT_GRANT", "CALLER_ROLE", "BUSINESS_ACCESS"})
    void businessChangesDoNotInterruptTheGrantedConnectionButNewDocumentsAreChecked(String change) throws Exception {
        String grant = grantFrom(bootstrap(launch()));
        switch (change) {
            case "TIME" -> {
                task.endAt = Instant.now().minusSeconds(1);
                tasks.saveAndFlush(task);
            }
            case "TASK_STARTED" -> {
                task.status = "EXECUTING";
                tasks.saveAndFlush(task);
            }
            case "PILOT_GRANT" -> {
                pilot.deviceIds = "";
                users.saveAndFlush(pilot);
            }
            case "CALLER_ROLE" -> {
                admin = users.findById(admin.id).orElseThrow();
                admin.role = Role.DEPARTMENT;
                users.saveAndFlush(admin);
            }
            case "BUSINESS_ACCESS" -> {
                binding = identities.findById(binding.id).orElseThrow();
                binding.businessAccessAssigned = false;
                identities.saveAndFlush(binding);
            }
            default -> throw new IllegalArgumentException(change);
        }
        clearInvocations(client, personalDevices);
        gateway(grant, "continue", 204);
        gateway(grant, "entry", "TASK_STARTED".equals(change) ? 204 : 403);
        // A denied fresh document does not revoke an already open stream credential.
        gateway(grant, "continue", 204);
        assertThat(grants.require(grant).taskId()).isEqualTo(task.id);
        verifyNoInteractions(client, personalDevices);
    }

    @ParameterizedTest
    @ValueSource(strings = {"INVALIDATE", "ROTATE", "OTHER_LOGIN", "DISABLE", "BINDING_REVISION"})
    void logoutAccountSwitchAndIdentityRevocationRejectContinuation(String change) throws Exception {
        String grant = grantFrom(bootstrap(launch()));
        switch (change) {
            case "INVALIDATE" -> session.invalidate();
            case "ROTATE" -> session.changeSessionId();
            case "OTHER_LOGIN" -> {
                UserAccount other = account("other-entry-admin", Role.ADMIN, admin.organizationId);
                var context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(other.username, "N/A", List.of()));
                session.setAttribute("SPRING_SECURITY_CONTEXT", context);
            }
            case "DISABLE" -> {
                admin = users.findById(admin.id).orElseThrow();
                admin.enabled = false;
                users.saveAndFlush(admin);
            }
            case "BINDING_REVISION" -> {
                binding = identities.findById(binding.id).orElseThrow();
                binding.bindingRevision = java.util.UUID.randomUUID().toString();
                identities.saveAndFlush(binding);
            }
            default -> throw new IllegalArgumentException(change);
        }
        gateway(grant, "continue", 401);
    }

    @Test
    void taskAndPreflightListingDoNotCallPersonalRemoteAuthorization() throws Exception {
        clearInvocations(client, personalDevices);
        mvc.perform(get("/api/v1/flight-control/tasks").session(session))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].eligible").value(true));
        mvc.perform(get("/api/v1/flight-control/preflight").session(session).param("taskId", task.id))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.eligible").value(true));
        verifyNoInteractions(client, personalDevices);
    }

    @Test
    void anOldSourceCookieWithoutAGrantCannotAuthorizeTheGateway() throws Exception {
        mvc.perform(get("/api/v1/flight-control/gateway-check")
                        .cookie(new jakarta.servlet.http.Cookie("access_token", TOKEN))
                        .header("X-Oneflight-Gateway-Secret", SECRET)
                        .header("X-Oneflight-Request-Kind", "entry"))
                .andExpect(status().isUnauthorized());
    }
}
