package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.domain.*;
import com.oneflight.integration.FlightCommandGateway;
import com.oneflight.repository.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;
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
class PlanTaskClosureIntegrationTest {
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
    private String otherOrganizationId;
    private String deviceId;
    private String pilotId;
    private String otherPilotId;

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
        organizationId = organization("本部门").id;
        otherOrganizationId = organization("其他部门").id;
        Resource device = new Resource();
        device.title = "执行设备";
        device.kind = "DEVICE";
        device.status = "ACTIVE";
        device.organizationId = organizationId;
        device.region = "西湖区";
        device.sourceDeviceId = "9007199254740993123";
        deviceId = resources.saveAndFlush(device).id;
        account("admin", Role.ADMIN, organizationId);
        account("dispatch", Role.DISPATCH, organizationId);
        account("department", Role.DEPARTMENT, organizationId);
        account("outsider", Role.DEPARTMENT, otherOrganizationId);
        pilotId = account("pilot", Role.PILOT, organizationId).id;
        otherPilotId = account("other-pilot", Role.PILOT, organizationId).id;
    }

    @AfterEach
    void businessProgressNeverSendsDeviceCommands() {
        verifyNoInteractions(commands);
    }

    @Test
    void approvedLongTermPlanSupportsRepeatedExecutionsThroughAcceptanceWithoutReviewingAgain()
            throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        String first = create(plan, "department", arrangement()).path("id").asText();
        Map<String, Object> secondBody = arrangement();
        secondBody.put("title", "周期巡查第二次执行");
        secondBody.put("startAt", "2026-10-17T01:00:00Z");
        secondBody.put("endAt", "2026-10-17T02:00:00Z");
        String second = create(plan, "department", secondBody).path("id").asText();
        assertThat(first).isNotEqualTo(second);
        action(first, "dispatch", Map.of("action", "ASSIGN", "deviceId", deviceId, "pilotId", pilotId))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("PENDING_EXECUTION"));
        action(first, "pilot", Map.of("action", "START")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("EXECUTING"));
        action(first, "pilot", Map.of("action", "FINISH", "resultSummary", "已提交巡查成果"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("PENDING_ACCEPTANCE"));
        action(first, "department", Map.of("action", "RETURN", "note", "补充重点点位说明"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("EXECUTING"));
        action(first, "pilot", Map.of("action", "FINISH", "resultSummary", "重点点位已补充"))
                .andExpect(status().isOk());
        action(first, "department", Map.of("action", "ACCEPT")).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("COMPLETED"));
        mvc.perform(get("/api/v1/plans/" + plan.id + "/tasks").with(user("department")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2));
        assertThat(tasks.findById(second).orElseThrow().status).isEqualTo("PENDING_ASSIGNMENT");
        assertThat(plans.findById(plan.id).orElseThrow().status).isEqualTo("APPROVED");
        assertThat(events.findAll().stream().filter(event -> "PLAN".equals(event.entityType))).isEmpty();
        assertThat(events.findAll().stream().filter(event -> first.equals(event.entityId))
                .map(event -> event.action)).containsExactly("CREATE_FROM_PLAN", "ASSIGN", "START", "FINISH", "RETURN", "FINISH", "ACCEPT");
    }

    @ParameterizedTest
    @CsvSource({"admin,DAILY", "dispatch,LONG_TERM", "department,LONG_TERM"})
    void inheritsTheApprovedPlanScopeAndStartsAtPendingAssignment(String actor, String kind)
            throws Exception {
        FlightPlan plan = plan(kind, "APPROVED");
        Map<String, Object> body = arrangement();
        body.put("organizationId", otherOrganizationId);
        body.put("region", "余杭区");
        body.put("deviceId", "untrusted-device");
        body.put("status", "COMPLETED");
        JsonNode result = create(plan, actor, body);
        assertThat(result.path("organizationId").asText()).isEqualTo(organizationId);
        assertThat(result.path("region").asText()).isEqualTo("西湖区");
        assertThat(result.path("status").asText()).isEqualTo("PENDING_ASSIGNMENT");
        assertThat(result.path("planId").asText()).isEqualTo(plan.id);
        assertThat(result.path("deviceId").isNull()).isTrue();
    }

    @Test
    void repeatedArrangementRequestReturnsOneTaskAndOneHistoryEvent() throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        Map<String, Object> body = arrangement();
        JsonNode first = create(plan, "department", body);
        JsonNode second = create(plan, "department", body);
        assertThat(first.path("id")).isEqualTo(second.path("id"));
        assertThat(tasks.count()).isEqualTo(1);
        assertThat(events.count()).isEqualTo(1);
        body.put("title", "使用同一请求编号改写内容");
        arrangeRequest(plan, "department", body).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
        assertThat(tasks.count()).isEqualTo(1);
    }

    @Test
    void idempotencySurvivesAnExplicitChangeOfTheTasksLinkedPlan() throws Exception {
        FlightPlan original = plan("LONG_TERM", "APPROVED");
        FlightPlan replacement = plan("DAILY", "APPROVED");
        Map<String, Object> body = arrangement();
        String taskId = create(original, "department", body).path("id").asText();
        action(taskId, "dispatch", Map.of("action", "LINK_PLAN", "planId", replacement.id))
                .andExpect(status().isOk());
        assertThat(create(original, "department", body).path("id").asText()).isEqualTo(taskId);
        assertThat(tasks.count()).isEqualTo(1);
        assertThat(tasks.findById(taskId).orElseThrow().planId).isEqualTo(replacement.id);
        arrangeRequest(original, "dispatch", body).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_CONFLICT"));
    }

    @Test
    void assignmentCanExplicitlyClearAnInvalidPlanButExecutionStillRequiresApproval()
            throws Exception {
        FlightPlan invalid = plan("LONG_TERM", "APPROVED");
        invalid.startAt = Instant.parse("2026-10-20T00:00:00Z");
        plans.saveAndFlush(invalid);
        Task task = task(invalid, "PENDING_ASSIGNMENT");
        action(task.id, "dispatch", Map.of("action", "ASSIGN", "deviceId", deviceId, "pilotId", pilotId))
                .andExpect(status().isBadRequest());
        action(task.id, "dispatch", Map.of("action", "ASSIGN", "deviceId", deviceId, "pilotId", pilotId, "planId", ""))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.planId").isEmpty())
                .andExpect(jsonPath("$.data.status").value("PENDING_EXECUTION"));
        action(task.id, "pilot", Map.of("action", "START")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PLAN_APPROVAL_REQUIRED"));
    }

    @Test
    void concurrentDoubleClickCreatesOnlyOneTask() throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        Map<String, Object> body = arrangement();
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            CountDownLatch ready = new CountDownLatch(2);
            CountDownLatch start = new CountDownLatch(1);
            Callable<String> call = () -> {
                ready.countDown();
                start.await(10, TimeUnit.SECONDS);
                return create(plan, "department", body).path("id").asText();
            };
            Future<String> first = executor.submit(call);
            Future<String> second = executor.submit(call);
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(first.get(20, TimeUnit.SECONDS)).isEqualTo(second.get(20, TimeUnit.SECONDS));
        }
        assertThat(tasks.count()).isEqualTo(1);
        assertThat(events.count()).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"DRAFT", "PENDING_REVIEW", "RETURNED", "CANCELLED"})
    void approvalIsRequiredBeforeArrangingFromAPlan(String state) throws Exception {
        FlightPlan plan = plan("LONG_TERM", state);
        arrangeRequest(plan, "department", arrangement()).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PLAN_APPROVAL_REQUIRED"));
        assertThat(tasks.count()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"DEVICE_ADMISSION", "PERSON_ADMISSION", "PILOT_ADMISSION"})
    void admissionsDoNotCreateExecutionTasks(String kind) throws Exception {
        arrangeRequest(plan(kind, "APPROVED"), "admin", arrangement())
                .andExpect(status().isBadRequest());
        assertThat(tasks.count()).isZero();
    }

    @ParameterizedTest
    @CsvSource({"2026-10-15T01:00:00Z,2026-10-16T02:00:00Z", "2026-10-16T01:00:00Z,2026-11-01T02:00:00Z", "2026-10-16T02:00:00Z,2026-10-16T02:00:00Z", "2026-10-16T03:00:00Z,2026-10-16T02:00:00Z"})
    void arrangementTimeMustStayWithinPlanAndBeAnActualInterval(String start, String end)
            throws Exception {
        Map<String, Object> body = arrangement();
        body.put("startAt", start);
        body.put("endAt", end);
        arrangeRequest(plan("LONG_TERM", "APPROVED"), "department", body)
                .andExpect(status().isBadRequest());
        assertThat(tasks.count()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"pilot", "outsider"})
    void pilotAndOtherDepartmentsCannotArrangeTasks(String actor) throws Exception {
        arrangeRequest(plan("LONG_TERM", "APPROVED"), actor, arrangement())
                .andExpect(status().isForbidden());
        assertThat(tasks.count()).isZero();
    }

    @Test
    void arrangementRequiresCsrfAndARequestIdentifier() throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        mvc.perform(post("/api/v1/plans/" + plan.id + "/tasks").with(user("department"))
                .contentType("application/json").content(json.writeValueAsString(arrangement())))
                .andExpect(status().isForbidden());
        Map<String, Object> body = arrangement();
        body.remove("requestId");
        arrangeRequest(plan, "department", body).andExpect(status().isBadRequest());
    }

    @Test
    void planTaskListsRequireBothParentAndTaskScopeAndSearchUsesTheLinkedPlanName()
            throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        Task mine = task(plan, "PENDING_EXECUTION");
        mine.pilotId = pilotId;
        tasks.saveAndFlush(mine);
        Task another = task(plan, "PENDING_EXECUTION");
        another.pilotId = otherPilotId;
        tasks.saveAndFlush(another);
        Task foreign = task(plan, "PENDING_ASSIGNMENT");
        foreign.organizationId = otherOrganizationId;
        tasks.saveAndFlush(foreign);
        mvc.perform(get("/api/v1/plans/" + plan.id + "/tasks").with(user("pilot")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1))
                .andExpect(jsonPath("$.data.items[0].id").value(mine.id));
        mvc.perform(get("/api/v1/plans/" + plan.id + "/tasks").with(user("outsider")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/tasks").param("planId", plan.id).param("keyword", "周期")
                .with(user("department"))).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(2));
        mvc.perform(get("/api/v1/tasks").param("keyword", plan.id).with(user("pilot")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/v1/tasks").param("planId", plan.id).with(user("outsider")))
                .andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @ValueSource(strings = {"MISSING", "PENDING_REVIEW", "RETURNED", "DRAFT"})
    void startingAFlightRequiresAnApprovedCompatiblePlan(String state) throws Exception {
        FlightPlan plan = plan("DAILY", "MISSING".equals(state) ? "APPROVED" : state);
        Task task = task(plan, "PENDING_EXECUTION");
        if ("MISSING".equals(state)) {
            task.planId = null;
            tasks.saveAndFlush(task);
        }
        action(task.id, "admin", Map.of("action", "START"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("PLAN_APPROVAL_REQUIRED"));
        assertThat(tasks.findById(task.id).orElseThrow().status).isEqualTo("PENDING_EXECUTION");
    }

    @Test
    void sourceVerificationWithoutAFlightPlanKeepsItsExistingProgressFlow() throws Exception {
        Task task = task(null, "PENDING_EXECUTION");
        task.scene = "资料核对";
        tasks.saveAndFlush(task);
        action(task.id, "admin", Map.of("action", "START")).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"REGION", "TIME", "KIND", "ORGANIZATION"})
    void linkingAndAssignmentRejectIncompatiblePlans(String mismatch) throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        if ("REGION".equals(mismatch)) plan.region = "余杭区";
        if ("TIME".equals(mismatch)) plan.startAt = Instant.parse("2026-10-20T00:00:00Z");
        if ("KIND".equals(mismatch)) plan.kind = "DEVICE_ADMISSION";
        if ("ORGANIZATION".equals(mismatch)) plan.organizationId = otherOrganizationId;
        plans.saveAndFlush(plan);
        Task task = task(null, "PENDING_ASSIGNMENT");
        action(task.id, "admin", Map.of("action", "LINK_PLAN", "planId", plan.id))
                .andExpect(status().isBadRequest());
        action(task.id, "admin", Map.of("action", "ASSIGN", "deviceId", deviceId, "pilotId", pilotId, "planId", plan.id))
                .andExpect(status().isBadRequest());
        assertThat(tasks.findById(task.id).orElseThrow().status).isEqualTo("PENDING_ASSIGNMENT");
        assertThat(tasks.findById(task.id).orElseThrow().planId).isNull();
    }

    @Test
    void legacyPlanTaskFieldSynchronizesTheCanonicalLinkWithoutLimitingLongTermReuse()
            throws Exception {
        Task first = task(null, "PENDING_ASSIGNMENT");
        Map<String, Object> body = planInput();
        body.put("taskId", first.id);
        planRequest(null, "dispatch", body).andExpect(status().isOk());
        // The response is read separately from the repositories to verify the committed link.
        FlightPlan plan = plans.findAll().getFirst();
        assertThat(tasks.findById(first.id).orElseThrow().planId).isEqualTo(plan.id);
        Task second = task(null, "PENDING_ASSIGNMENT");
        action(second.id, "dispatch", Map.of("action", "LINK_PLAN", "planId", plan.id))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/plans/" + plan.id + "/tasks").with(user("department")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(2));
        FlightPlan replacement = plan("LONG_TERM", "APPROVED");
        action(first.id, "dispatch", Map.of("action", "LINK_PLAN", "planId", replacement.id))
                .andExpect(status().isOk());
        assertThat(plans.findById(plan.id).orElseThrow().taskId).isNull();
        assertThat(tasks.findByPlanId(plan.id)).extracting(task -> task.id).containsExactly(second.id);
    }

    @Test
    void legacyPlanLinkCannotOverwriteAnotherPlanOrModifyAnExecutingTask() throws Exception {
        FlightPlan other = plan("DAILY", "APPROVED");
        Task task = task(other, "PENDING_ASSIGNMENT");
        Map<String, Object> body = planInput();
        body.put("taskId", task.id);
        planRequest(null, "admin", body).andExpect(status().isBadRequest());
        task.planId = null;
        task.status = "EXECUTING";
        tasks.saveAndFlush(task);
        planRequest(null, "admin", body).andExpect(status().isConflict());
        assertThat(plans.count()).isEqualTo(1);
        assertThat(tasks.findById(task.id).orElseThrow().planId).isNull();
    }

    @Test
    void planEditingCannotShrinkTheScopeOfAlreadyAssociatedTasks() throws Exception {
        FlightPlan plan = plan("LONG_TERM", "DRAFT");
        task(plan, "PENDING_ASSIGNMENT");
        Map<String, Object> body = planInput();
        body.put("region", "余杭区");
        planRequest(plan.id, "admin", body).andExpect(status().isBadRequest());
        body.put("region", "西湖区");
        body.put("startAt", "2026-10-20T00:00:00Z");
        planRequest(plan.id, "admin", body).andExpect(status().isBadRequest());
        assertThat(plans.findById(plan.id).orElseThrow().region).isEqualTo("西湖区");
    }

    @ParameterizedTest
    @ValueSource(strings = {"REGION", "TIME", "KIND", "ORGANIZATION"})
    void creatingOrEditingADraftTaskCannotStoreAnIncompatiblePlan(String mismatch) throws Exception {
        FlightPlan plan = plan("LONG_TERM", "APPROVED");
        if ("REGION".equals(mismatch)) plan.region = "余杭区";
        if ("TIME".equals(mismatch)) plan.startAt = Instant.parse("2026-10-20T00:00:00Z");
        if ("KIND".equals(mismatch)) plan.kind = "PERSON_ADMISSION";
        if ("ORGANIZATION".equals(mismatch)) plan.organizationId = otherOrganizationId;
        plans.saveAndFlush(plan);
        Map<String, Object> body = arrangement();
        body.put("region", "西湖区");
        body.put("planId", plan.id);
        mvc.perform(post("/api/v1/tasks").with(user("admin")).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
        Task draft = task(null, "DRAFT");
        mvc.perform(put("/api/v1/tasks/" + draft.id).with(user("admin")).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(body)))
                .andExpect(status().isBadRequest());
        assertThat(tasks.findById(draft.id).orElseThrow().planId).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"department", "pilot"})
    void legacyPlanInputCannotBypassDispatchLinkingAuthority(String actor) throws Exception {
        Task task = task(null, "PENDING_EXECUTION");
        task.pilotId = pilotId;
        tasks.saveAndFlush(task);
        Map<String, Object> body = planInput();
        body.put("taskId", task.id);
        planRequest(null, actor, body).andExpect(status().isForbidden());
        assertThat(plans.count()).isZero();
        assertThat(tasks.findById(task.id).orElseThrow().planId).isNull();
    }

    private JsonNode create(FlightPlan plan, String actor, Map<String, Object> body) throws Exception {
        String response = arrangeRequest(plan, actor, body).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(response).path("data");
    }

    private ResultActions arrangeRequest(FlightPlan plan, String actor, Map<String, Object> body)
            throws Exception {
        return mvc.perform(post("/api/v1/plans/" + plan.id + "/tasks").with(user(actor)).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(body)));
    }

    private ResultActions action(String taskId, String actor, Map<String, Object> body) throws Exception {
        return mvc.perform(post("/api/v1/tasks/" + taskId + "/actions").with(user(actor)).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(body)));
    }

    private ResultActions planRequest(String id, String actor, Map<String, Object> body) throws Exception {
        return mvc.perform((id == null ? post("/api/v1/plans") : put("/api/v1/plans/" + id))
                .with(user(actor)).with(csrf()).contentType("application/json")
                .content(json.writeValueAsString(body)));
    }

    private Map<String, Object> arrangement() {
        return new LinkedHashMap<>(Map.of("title", "周期巡查执行", "scene", "森林防火",
                "description", "重点区域检查", "priority", "NORMAL", "startAt", "2026-10-16T01:00:00Z",
                "endAt", "2026-10-16T02:00:00Z", "requestId", UUID.randomUUID().toString()));
    }

    private Map<String, Object> planInput() {
        return new LinkedHashMap<>(Map.of("title", "重点区域周期飞行计划", "kind", "LONG_TERM",
                "region", "西湖区", "startAt", "2026-10-16T00:00:00Z", "endAt", "2026-10-31T10:00:00Z"));
    }

    private FlightPlan plan(String kind, String state) {
        FlightPlan plan = new FlightPlan();
        plan.title = "重点区域周期飞行计划";
        plan.organizationId = organizationId;
        plan.region = "西湖区";
        plan.kind = kind;
        plan.status = state;
        plan.createdBy = users.findByUsername("department").orElseThrow().id;
        plan.startAt = Instant.parse("2026-10-16T00:00:00Z");
        plan.endAt = Instant.parse("2026-10-31T10:00:00Z");
        return plans.saveAndFlush(plan);
    }

    private Task task(FlightPlan plan, String state) {
        Task task = new Task();
        task.title = "具体执行任务";
        task.organizationId = organizationId;
        task.region = "西湖区";
        task.scene = "森林防火";
        task.status = state;
        task.planId = plan == null ? null : plan.id;
        task.startAt = Instant.parse("2026-10-16T01:00:00Z");
        task.endAt = Instant.parse("2026-10-16T02:00:00Z");
        return tasks.saveAndFlush(task);
    }

    private Organization organization(String title) {
        Organization organization = new Organization();
        organization.title = title;
        organization.organizationId = organization.id;
        organization.region = "西湖区";
        organization.status = "ACTIVE";
        return organizations.saveAndFlush(organization);
    }

    private UserAccount account(String username, Role role, String organization) {
        UserAccount account = new UserAccount();
        account.username = username;
        account.displayName = username;
        account.role = role;
        account.organizationId = organization;
        account.passwordHash = "not-used-by-mock-authentication";
        account.regions = "西湖区";
        account.deviceIds = deviceId;
        return users.saveAndFlush(account);
    }
}
