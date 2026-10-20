package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class PilotPlanAccessIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired TaskRepository tasks;
    @Autowired FlightPlanRepository plans;
    @Autowired UserAccountRepository users;
    @Autowired OrganizationRepository organizations;
    @Autowired AuditEventRepository events;
    @Autowired AttachmentRepository attachments;
    @Autowired ResourceRepository resources;
    @Autowired IndustryCaseRepository cases;
    @Autowired ConsultationRepository consultations;

    private final ObjectMapper json = new ObjectMapper();
    private String organizationId;
    private String foreignOrganizationId;
    private String pilotId;
    private String otherPilotId;
    private String departmentId;

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
        organizationId = organization("任务部门").id;
        foreignOrganizationId = organization("其他部门").id;
        pilotId = account("pilot", Role.PILOT).id;
        otherPilotId = account("other-pilot", Role.PILOT).id;
        departmentId = account("department", Role.DEPARTMENT).id;
    }

    @Test
    void assignedPilotCanReadTheReverseLinkedPlanAndHistoryWithoutAnInverseTaskId()
            throws Exception {
        FlightPlan plan = plan("APPROVED");
        assertThat(plan.taskId).isNull();
        assignedTask(plan, pilotId);

        mvc.perform(get("/api/v1/plans/" + plan.id).with(user("pilot")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.id").value(plan.id))
                .andExpect(jsonPath("$.data.status").value("APPROVED"));
        mvc.perform(get("/api/v1/plans").with(user("pilot")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/v1/plans/" + plan.id + "/history").with(user("pilot")))
                .andExpect(status().isOk());
        assertThat(events.count()).isZero();
    }

    @Test
    void unrelatedPlansAndAnotherPilotsAssociationRemainInvisible() throws Exception {
        FlightPlan unrelated = plan("APPROVED");
        FlightPlan other = plan("APPROVED");
        assignedTask(other, otherPilotId);
        forbiddenRead(unrelated, "pilot");
        forbiddenRead(other, "pilot");
        mvc.perform(get("/api/v1/plans").with(user("pilot")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
    }

    @ParameterizedTest
    @CsvSource({"PLAN,ORGANIZATION", "PLAN,REGION", "TASK,ORGANIZATION", "TASK,REGION"})
    void bothThePlanAndAssignedTaskMustRemainInsideThePilotsScope(String entity, String field)
            throws Exception {
        FlightPlan plan = plan("APPROVED");
        Task task = assignedTask(plan, pilotId);
        if ("PLAN".equals(entity)) {
            if ("ORGANIZATION".equals(field)) plan.organizationId = foreignOrganizationId;
            else plan.region = "宁波市";
            plans.saveAndFlush(plan);
        } else {
            if ("ORGANIZATION".equals(field)) task.organizationId = foreignOrganizationId;
            else task.region = "宁波市";
            tasks.saveAndFlush(task);
        }
        forbiddenRead(plan, "pilot");
        mvc.perform(get("/api/v1/plans").with(user("pilot")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
    }

    @Test
    void reassignmentRevokesTheFormerPilotOnTheNextRequestAndAllowsTheNewPilot()
            throws Exception {
        FlightPlan plan = plan("APPROVED");
        Task task = assignedTask(plan, pilotId);
        mvc.perform(get("/api/v1/plans/" + plan.id).with(user("pilot")))
                .andExpect(status().isOk());
        task.pilotId = otherPilotId;
        tasks.saveAndFlush(task);

        forbiddenRead(plan, "pilot");
        mvc.perform(get("/api/v1/plans").with(user("pilot")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/v1/plans/" + plan.id).with(user("other-pilot")))
                .andExpect(status().isOk());
    }

    @Test
    void removingThePlanAssociationRevokesReadAccess() throws Exception {
        FlightPlan plan = plan("APPROVED");
        Task task = assignedTask(plan, pilotId);
        task.planId = null;
        tasks.saveAndFlush(task);
        forbiddenRead(plan, "pilot");
    }

    @ParameterizedTest
    @ValueSource(strings = {"DRAFT", "RETURNED"})
    void aReverseLinkedPlanDoesNotGrantEditPermission(String state) throws Exception {
        FlightPlan plan = plan(state);
        assignedTask(plan, pilotId);
        Map<String, Object> before = plans.findById(plan.id).orElseThrow().view();
        mvc.perform(put("/api/v1/plans/" + plan.id).with(user("pilot")).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(planInput())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        assertThat(plans.findById(plan.id).orElseThrow().view()).isEqualTo(before);
        assertThat(events.count()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"SUBMIT", "CANCEL", "APPROVE", "RETURN", "REGISTER_RECEIPT"})
    void aReverseLinkedPlanDoesNotGrantAnyHandlingPermission(String action) throws Exception {
        FlightPlan plan = plan("PENDING_REVIEW");
        assignedTask(plan, pilotId);
        Map<String, Object> before = plans.findById(plan.id).orElseThrow().view();
        mvc.perform(post("/api/v1/plans/" + plan.id + "/actions").with(user("pilot")).with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(Map.of("action", action, "note", "不能办理他人计划"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        assertThat(plans.findById(plan.id).orElseThrow().view()).isEqualTo(before);
        assertThat(events.count()).isZero();
    }

    @Test
    void pilotsRetainTheirOwnPlanCreationEditingSubmissionAndCancellation() throws Exception {
        String created = mvc.perform(post("/api/v1/plans").with(user("pilot")).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(planInput())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("DRAFT"))
                .andReturn().getResponse().getContentAsString();
        String id = json.readTree(created).path("data").path("id").asText();
        mvc.perform(put("/api/v1/plans/" + id).with(user("pilot")).with(csrf())
                .contentType("application/json").content(json.writeValueAsString(planInput())))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/plans/" + id + "/actions").with(user("pilot")).with(csrf())
                .contentType("application/json").content("{\"action\":\"SUBMIT\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING_REVIEW"));
        mvc.perform(post("/api/v1/plans/" + id + "/actions").with(user("pilot")).with(csrf())
                .contentType("application/json").content("{\"action\":\"CANCEL\",\"note\":\"申请人撤销\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("CANCELLED"));
        assertThat(plans.findById(id).orElseThrow().createdBy).isEqualTo(pilotId);
    }

    @ParameterizedTest
    @ValueSource(strings = {"APPROVE", "RETURN"})
    void pilotsCannotApproveOrReturnEvenTheirOwnPlans(String action) throws Exception {
        FlightPlan plan = plan("PENDING_REVIEW");
        plan.createdBy = pilotId;
        plans.saveAndFlush(plan);
        mvc.perform(post("/api/v1/plans/" + plan.id + "/actions").with(user("pilot")).with(csrf())
                .contentType("application/json")
                .content(json.writeValueAsString(Map.of("action", action, "note", "本人无审核权限"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void reassignmentDoesNotRemoveTheCreatorsExistingReadAccess() throws Exception {
        FlightPlan plan = plan("APPROVED");
        plan.createdBy = pilotId;
        plans.saveAndFlush(plan);
        assignedTask(plan, otherPilotId);
        mvc.perform(get("/api/v1/plans/" + plan.id).with(user("pilot")))
                .andExpect(status().isOk());
    }

    private void forbiddenRead(FlightPlan plan, String actor) throws Exception {
        mvc.perform(get("/api/v1/plans/" + plan.id).with(user(actor)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/plans/" + plan.id + "/history").with(user(actor)))
                .andExpect(status().isForbidden());
    }

    private Map<String, Object> planInput() {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("title", "飞手本人的飞行计划");
        input.put("kind", "DAILY");
        input.put("region", "杭州市");
        input.put("startAt", "2026-10-15T01:00:00Z");
        input.put("endAt", "2026-10-15T02:00:00Z");
        input.put("scope", "计划作业范围");
        return input;
    }

    private FlightPlan plan(String state) {
        FlightPlan plan = new FlightPlan();
        plan.title = "部门关联飞行计划";
        plan.organizationId = organizationId;
        plan.region = "杭州市";
        plan.kind = "DAILY";
        plan.status = state;
        plan.createdBy = departmentId;
        return plans.saveAndFlush(plan);
    }

    private Task assignedTask(FlightPlan plan, String pilot) {
        Task task = new Task();
        task.title = "已分配任务";
        task.organizationId = organizationId;
        task.region = "杭州市";
        task.status = "PENDING_EXECUTION";
        task.pilotId = pilot;
        task.planId = plan.id;
        task.startAt = Instant.parse("2026-10-15T01:00:00Z");
        task.endAt = Instant.parse("2026-10-15T02:00:00Z");
        return tasks.saveAndFlush(task);
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
        account.passwordHash = "not-used-by-mock-authentication";
        account.role = role;
        account.organizationId = organizationId;
        account.regions = "杭州市";
        return users.saveAndFlush(account);
    }
}
