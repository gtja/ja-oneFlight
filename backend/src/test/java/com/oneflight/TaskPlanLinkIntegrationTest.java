package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.integration.FlightCommandGateway;
import com.oneflight.repository.AttachmentRepository;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.ConsultationRepository;
import com.oneflight.repository.FlightPlanRepository;
import com.oneflight.repository.IndustryCaseRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TaskPlanLinkIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired TaskRepository tasks;
    @Autowired FlightPlanRepository plans;
    @Autowired ResourceRepository resources;
    @Autowired UserAccountRepository users;
    @Autowired OrganizationRepository organizations;
    @Autowired AuditEventRepository events;
    @Autowired AttachmentRepository attachments;
    @Autowired IndustryCaseRepository cases;
    @Autowired ConsultationRepository consultations;
    @MockitoSpyBean FlightCommandGateway commands;

    private final ObjectMapper json = new ObjectMapper();
    private String organizationId;
    private String foreignOrganizationId;
    private String deviceId;
    private String pilotId;

    @BeforeEach
    void fixture() {
        attachments.deleteAll();
        events.deleteAll();
        tasks.deleteAll();
        plans.deleteAll();
        cases.deleteAll();
        consultations.deleteAll();
        resources.deleteAll();
        users.deleteAll();
        organizations.deleteAll();
        organizationId = organization("需求部门").id;
        foreignOrganizationId = organization("其他部门").id;
        Resource device = new Resource();
        device.title = "关联计划设备";
        device.kind = "DEVICE";
        device.status = "ACTIVE";
        device.organizationId = organizationId;
        device.region = "杭州市";
        device.sourceDeviceId = "9007199254740993123";
        deviceId = resources.save(device).id;
        account("admin", Role.ADMIN);
        account("dispatch", Role.DISPATCH);
        account("department", Role.DEPARTMENT);
        pilotId = account("pilot", Role.PILOT).id;
    }

    @AfterEach
    void linkingNeverCallsADeviceCommand() {
        verifyNoInteractions(commands);
    }

    @ParameterizedTest
    @CsvSource({
        "admin,PENDING_ASSIGNMENT,DAILY,DRAFT",
        "dispatch,PENDING_EXECUTION,LONG_TERM,PENDING_REVIEW",
        "admin,PENDING_EXECUTION,DAILY,RETURNED",
        "dispatch,PENDING_ASSIGNMENT,LONG_TERM,APPROVED"
    })
    void linksAnAccessibleFlightPlanWithoutChangingTaskProgressOrAssignment(
            String actor, String taskStatus, String planKind, String planStatus) throws Exception {
        Task task = task(taskStatus);
        FlightPlan original = plan("DAILY", "DRAFT", organizationId);
        task.planId = original.id;
        tasks.saveAndFlush(task);
        Map<String, Object> before = businessFields(task);
        FlightPlan linked = plan(planKind, planStatus, organizationId);
        Map<String, Object> body = linkBody(linked.id);
        body.put("deviceId", "must-not-change-device");
        body.put("pilotId", "must-not-change-pilot");
        body.put("resultSummary", "must-not-change-results");

        request(task.id, actor, body)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value(taskStatus))
                .andExpect(jsonPath("$.data.planId").value(linked.id));

        Task persisted = tasks.findById(task.id).orElseThrow();
        assertThat(businessFields(persisted)).isEqualTo(before);
        assertThat(persisted.planId).isEqualTo(linked.id);
        assertThat(plans.findById(linked.id).orElseThrow().status).isEqualTo(planStatus);
        assertThat(resources.findById(deviceId).orElseThrow().sourceDeviceId)
                .isEqualTo("9007199254740993123");
        assertThat(events.findAll()).singleElement().satisfies(event -> {
            assertThat(event.entityType).isEqualTo("TASK");
            assertThat(event.entityId).isEqualTo(task.id);
            assertThat(event.action).isEqualTo("LINK_PLAN");
            assertThat(event.note).isEqualTo("补充关联飞行计划");
            assertThat(event.actorName).isEqualTo(actor);
        });
    }

    @ParameterizedTest
    @ValueSource(strings = {"DEVICE_ADMISSION", "PILOT_ADMISSION", "PERSON_ADMISSION"})
    void rejectsAdmissionApplicationsWithoutChangingTheTask(String kind) throws Exception {
        Task task = task("PENDING_EXECUTION");
        FlightPlan admission = plan(kind, "APPROVED", organizationId);
        rejected(task, "dispatch", admission.id, 400, "INVALID_REQUEST");
    }

    @Test
    void rejectsAnUnspecifiedLegacyPlanKindInsteadOfReturningAServerError() throws Exception {
        Task task = task("PENDING_EXECUTION");
        FlightPlan unspecified = plan(null, "DRAFT", organizationId);
        rejected(task, "admin", unspecified.id, 400, "INVALID_REQUEST");
    }

    @Test
    void rejectsACancelledPlan() throws Exception {
        Task task = task("PENDING_ASSIGNMENT");
        FlightPlan cancelled = plan("DAILY", "CANCELLED", organizationId);
        rejected(task, "admin", cancelled.id, 400, "INVALID_REQUEST");
    }

    @Test
    void enforcesSourceAccessAndSameOrganizationEvenForAnAdministratorOrGrantedDispatcher()
            throws Exception {
        Task task = task("PENDING_EXECUTION");
        FlightPlan foreign = plan("DAILY", "APPROVED", foreignOrganizationId);
        rejected(task, "dispatch", foreign.id, 403, "FORBIDDEN");
        rejected(task, "admin", foreign.id, 400, "INVALID_REQUEST");
        UserAccount dispatcher = users.findByUsername("dispatch").orElseThrow();
        dispatcher.organizationIds = foreignOrganizationId;
        users.saveAndFlush(dispatcher);
        rejected(task, "dispatch", foreign.id, 400, "INVALID_REQUEST");
    }

    @ParameterizedTest
    @ValueSource(strings = {"DRAFT", "RETURNED", "EXECUTING", "PENDING_ACCEPTANCE", "COMPLETED", "CANCELLED"})
    void rejectsTasksOutsideThePreparationStages(String state) throws Exception {
        Task task = task(state);
        FlightPlan approved = plan("DAILY", "APPROVED", organizationId);
        rejected(task, "admin", approved.id, 409, "INVALID_TRANSITION");
    }

    @ParameterizedTest
    @ValueSource(strings = {"department", "pilot"})
    void rejectsReadAuthorizedUsersWhoCannotLinkPlans(String actor) throws Exception {
        Task task = task("PENDING_EXECUTION");
        FlightPlan approved = plan("DAILY", "APPROVED", organizationId);
        rejected(task, actor, approved.id, 403, "FORBIDDEN");
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"   "})
    void requiresAPlanIdentifier(String planId) throws Exception {
        rejected(task("PENDING_EXECUTION"), "admin", planId, 400, "INVALID_REQUEST");
    }

    @Test
    void rejectsAnUnknownPlanIdentifier() throws Exception {
        rejected(task("PENDING_ASSIGNMENT"), "admin", "missing-plan", 404, "NOT_FOUND");
    }

    private void rejected(Task task, String actor, String planId, int expectedStatus, String code)
            throws Exception {
        Map<String, Object> before = new LinkedHashMap<>(tasks.findById(task.id).orElseThrow().view());
        request(task.id, actor, linkBody(planId))
                .andExpect(status().is(expectedStatus))
                .andExpect(jsonPath("$.code").value(code));
        assertThat(tasks.findById(task.id).orElseThrow().view()).isEqualTo(before);
        assertThat(events.count()).isZero();
    }

    private ResultActions request(String taskId, String actor, Map<String, Object> body)
            throws Exception {
        return mvc.perform(post("/api/v1/tasks/" + taskId + "/actions")
                .with(user(actor)).with(csrf()).contentType("application/json")
                .content(json.writeValueAsString(body)));
    }

    private Map<String, Object> linkBody(String planId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("action", "LINK_PLAN");
        body.put("planId", planId);
        body.put("note", "补充关联飞行计划");
        return body;
    }

    private Map<String, Object> businessFields(Task task) {
        Map<String, Object> fields = new LinkedHashMap<>(task.view());
        fields.remove("planId");
        fields.remove("updatedAt");
        return fields;
    }

    private Task task(String state) {
        Task task = new Task();
        task.title = "原任务关联计划";
        task.organizationId = organizationId;
        task.region = "杭州市";
        task.status = state;
        task.scene = "森林防火";
        task.description = "保留原任务业务要求";
        task.startAt = Instant.parse("2026-10-15T01:00:00Z");
        task.endAt = Instant.parse("2026-10-15T02:00:00Z");
        if (!"PENDING_ASSIGNMENT".equals(state)) {
            task.deviceId = deviceId;
            task.pilotId = pilotId;
        }
        return tasks.saveAndFlush(task);
    }

    private FlightPlan plan(String kind, String state, String organization) {
        FlightPlan plan = new FlightPlan();
        plan.title = "待关联的飞行计划";
        plan.organizationId = organization;
        plan.region = "杭州市";
        plan.kind = kind;
        plan.status = state;
        plan.startAt = Instant.parse("2026-10-15T00:00:00Z");
        plan.endAt = Instant.parse("2026-10-15T08:00:00Z");
        return plans.saveAndFlush(plan);
    }

    private Organization organization(String title) {
        Organization organization = new Organization();
        organization.title = title;
        organization.organizationId = organization.id;
        organization.region = "杭州市";
        organization.status = "ACTIVE";
        return organizations.saveAndFlush(organization);
    }

    private UserAccount account(String username, Role role) {
        UserAccount account = new UserAccount();
        account.username = username;
        account.displayName = username;
        account.role = role;
        account.organizationId = organizationId;
        account.passwordHash = "not-used-by-mock-authentication";
        account.regions = "杭州市";
        account.deviceIds = deviceId;
        return users.saveAndFlush(account);
    }
}
