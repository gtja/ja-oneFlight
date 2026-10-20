package com.oneflight;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.oneflight.auth.Role;
import com.oneflight.domain.*;
import com.oneflight.repository.*;

import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class WorkflowIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired UserAccountRepository users;
    @Autowired OrganizationRepository organizations;
    @Autowired TaskRepository tasks;
    @Autowired ResourceRepository resources;
    @Autowired FlightPlanRepository plans;
    @Autowired IndustryCaseRepository cases;
    @Autowired ConsultationRepository consultations;
    @Autowired AuditEventRepository events;
    @Autowired AttachmentRepository attachments;
    @Autowired PasswordEncoder encoder;
    String organizationId;
    String otherOrganizationId;
    String deviceId;
    String pilotId;
    com.fasterxml.jackson.databind.ObjectMapper json =
            new com.fasterxml.jackson.databind.ObjectMapper();

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
        Organization a = new Organization();
        a.title = "业务部门";
        a.status = "ACTIVE";
        a.region = "杭州市";
        a.organizationId = a.id;
        organizations.save(a);
        organizationId = a.id;
        Organization b = new Organization();
        b.title = "其他部门";
        b.status = "ACTIVE";
        b.region = "杭州市";
        b.organizationId = b.id;
        organizations.save(b);
        otherOrganizationId = b.id;
        Resource d = new Resource();
        d.title = "测试设备";
        d.status = "ACTIVE";
        d.kind = "DEVICE";
        d.organizationId = a.id;
        d.region = "杭州市";
        d.sourceDeviceId = "9007199254740993123";
        resources.save(d);
        deviceId = d.id;
        account("admin", Role.ADMIN, a.id, "");
        account("dispatch", Role.DISPATCH, a.id, d.id);
        account("department", Role.DEPARTMENT, a.id, d.id);
        pilotId = account("pilot", Role.PILOT, a.id, d.id).id;
        account("outsider", Role.DEPARTMENT, b.id, "");
    }

    UserAccount account(String username, Role role, String org, String devices) {
        UserAccount u = new UserAccount();
        u.username = username;
        u.displayName = username;
        u.passwordHash = encoder.encode("testPassword123!");
        u.role = role;
        u.organizationId = org;
        u.regions = "杭州市";
        u.deviceIds = devices;
        return users.save(u);
    }

    String payload(String title) {
        return "{\"title\":\""
                + title
                + "\",\"description\":\"巡查\",\"scene\":\"森林防火\",\"priority\":\"NORMAL\",\"region\":\"杭州市\",\"startAt\":\"2026-10-15T01:00:00Z\",\"endAt\":\"2026-10-15T02:00:00Z\"}";
    }

    String createTask(String title) throws Exception {
        String body =
                mvc.perform(
                                post("/api/v1/tasks")
                                        .with(user("department"))
                                        .with(csrf())
                                        .contentType("application/json")
                                        .content(payload(title)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.status").value("DRAFT"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return json.readTree(body).path("data").path("id").asText();
    }

    void action(String id, String user, String body, String expected) throws Exception {
        mvc.perform(
                        post("/api/v1/tasks/" + id + "/actions")
                                .with(user(user))
                                .with(csrf())
                                .contentType("application/json")
                                .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value(expected));
    }

    String assignment() {
        return "{\"action\":\"ASSIGN\",\"deviceId\":\""
                + deviceId
                + "\",\"pilotId\":\""
                + pilotId
                + "\"}";
    }

    @Test
    void completeTaskWorkflowPersistsAndKeepsHistory() throws Exception {
        String id = createTask("山林巡查");
        action(id, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        action(id, "dispatch", assignment(), "PENDING_EXECUTION");
        FlightPlan approved = new FlightPlan();
        approved.title = "已批巡查计划";
        approved.kind = "DAILY";
        approved.organizationId = organizationId;
        approved.region = "杭州市";
        approved.status = "APPROVED";
        approved.startAt = java.time.Instant.parse("2026-10-15T01:00:00Z");
        approved.endAt = java.time.Instant.parse("2026-10-15T02:00:00Z");
        plans.saveAndFlush(approved);
        action(id, "dispatch", "{\"action\":\"LINK_PLAN\",\"planId\":\"" + approved.id + "\"}", "PENDING_EXECUTION");
        action(id, "pilot", "{\"action\":\"START\"}", "EXECUTING");
        action(
                id,
                "pilot",
                "{\"action\":\"FINISH\",\"resultSummary\":\"实际巡查成果\"}",
                "PENDING_ACCEPTANCE");
        action(id, "department", "{\"action\":\"RETURN\",\"note\":\"补充成果说明\"}", "EXECUTING");
        action(id, "pilot", "{\"action\":\"FINISH\"}", "PENDING_ACCEPTANCE");
        action(id, "department", "{\"action\":\"ACCEPT\"}", "COMPLETED");
        assertThat(tasks.findById(id).orElseThrow().status).isEqualTo("COMPLETED");
        mvc.perform(get("/api/v1/tasks/" + id + "/history").with(user("department")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(9));
    }

    @Test
    void scopeRolesCsrfAndIllegalTransitionsAreEnforced() throws Exception {
        String id = createTask("权限检查");
        mvc.perform(get("/api/v1/tasks/" + id).with(user("outsider")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/tasks/" + id).with(user("pilot")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/tasks").with(user("outsider")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(
                        post("/api/v1/tasks/" + id + "/actions")
                                .with(user("department"))
                                .contentType("application/json")
                                .content("{\"action\":\"SUBMIT\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(
                        post("/api/v1/tasks/" + id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"ACCEPT\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_TRANSITION"));
        action(id, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        mvc.perform(
                        post("/api/v1/tasks/" + id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(assignment()))
                .andExpect(status().isForbidden());
        action(id, "dispatch", "{\"action\":\"RETURN\",\"note\":\"请补充范围\"}", "RETURNED");
        action(id, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        action(id, "department", "{\"action\":\"CANCEL\",\"note\":\"需求取消\"}", "CANCELLED");
    }

    @Test
    void preventsOverlappingResourceAssignmentsAndPreservesLongIds() throws Exception {
        String a = createTask("任务一"), b = createTask("任务二");
        action(a, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        action(b, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        action(a, "dispatch", assignment(), "PENDING_EXECUTION");
        mvc.perform(
                        post("/api/v1/tasks/" + b + "/actions")
                                .with(user("dispatch"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(assignment()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESOURCE_CONFLICT"));
        mvc.perform(get("/api/v1/resources/" + deviceId).with(user("dispatch")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sourceDeviceId").value("9007199254740993123"));
    }

    @Test
    void plansConsultationsAndCasesHaveSimpleReviewFlows() throws Exception {
        String planJson =
                "{\"title\":\"日常计划\",\"kind\":\"DAILY\",\"region\":\"杭州市\",\"startAt\":\"2026-10-15T01:00:00Z\",\"endAt\":\"2026-10-15T02:00:00Z\",\"height\":100}";
        String body =
                mvc.perform(
                                post("/api/v1/plans")
                                        .with(user("department"))
                                        .with(csrf())
                                        .contentType("application/json")
                                        .content(planJson))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String id = json.readTree(body).path("data").path("id").asText();
        mvc.perform(
                        post("/api/v1/plans/" + id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"SUBMIT\"}"))
                .andExpect(jsonPath("$.data.status").value("PENDING_REVIEW"));
        mvc.perform(
                        post("/api/v1/plans/" + id + "/actions")
                                .with(user("dispatch"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"APPROVE\"}"))
                .andExpect(jsonPath("$.data.status").value("APPROVED"));
        mvc.perform(
                        post("/api/v1/plans/" + id + "/actions")
                                .with(user("dispatch"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(
                                        "{\"action\":\"REGISTER_RECEIPT\",\"receiptNumber\":\"HZ-20261015\",\"receiptBasis\":\"人工登记\"}"))
                .andExpect(jsonPath("$.data.receiptNumber").value("HZ-20261015"));
        body =
                mvc.perform(
                                post("/api/v1/cases")
                                        .with(user("department"))
                                        .with(csrf())
                                        .contentType("application/json")
                                        .content(
                                                "{\"title\":\"火情线索\",\"scene\":\"森林防火\",\"region\":\"杭州市\"}"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        id = json.readTree(body).path("data").path("id").asText();
        for (String action : List.of("VERIFY", "RESOLVE"))
            mvc.perform(
                            post("/api/v1/cases/" + id + "/actions")
                                    .with(user("department"))
                                    .with(csrf())
                                    .contentType("application/json")
                                    .content("{\"action\":\"" + action + "\",\"note\":\"核实并已处理\"}"))
                    .andExpect(status().isOk());
        assertThat(cases.findById(id).orElseThrow().status).isEqualTo("ARCHIVED");
        body =
                mvc.perform(
                                post("/api/v1/consultations")
                                        .with(user("department"))
                                        .with(csrf())
                                        .contentType("application/json")
                                        .content(
                                                "{\"title\":\"培训咨询\",\"kind\":\"TRAINING\",\"region\":\"杭州市\",\"description\":\"申请培训\"}"))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        id = json.readTree(body).path("data").path("id").asText();
        mvc.perform(
                        post("/api/v1/consultations/" + id + "/actions")
                                .with(user("dispatch"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"REPLY\",\"reply\":\"已安排培训\"}"))
                .andExpect(jsonPath("$.data.reply").value("已安排培训"));
        mvc.perform(
                        post("/api/v1/consultations/" + id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"COMPLETE\"}"))
                .andExpect(jsonPath("$.data.status").value("COMPLETED"));
    }

    @Test
    void attachmentsRequireLinkedEntityAccess() throws Exception {
        String taskId = createTask("附件任务");
        MockMultipartFile file =
                new MockMultipartFile(
                        "file",
                        "evidence.txt",
                        "text/plain",
                        "真实成果附件".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String body =
                mvc.perform(
                                multipart("/api/v1/attachments")
                                        .file(file)
                                        .param("taskId", taskId)
                                        .with(user("department"))
                                        .with(csrf()))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.data.fileName").value("evidence.txt"))
                        .andExpect(jsonPath("$.data.taskId").value(taskId))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String id = json.readTree(body).path("data").path("id").asText();
        mvc.perform(get("/api/v1/attachments/" + id + "/content").with(user("department")))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Content-Type-Options", "nosniff"));
        mvc.perform(get("/api/v1/attachments/" + id + "/content").with(user("outsider")))
                .andExpect(status().isForbidden());
    }

    @Test
    void sessionAuthenticationAndReadOnlySettingsBoundaries() throws Exception {
        mvc.perform(get("/api/v1/tasks")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.headerName").value("X-CSRF-TOKEN"));
        var result =
                mvc.perform(
                                post("/api/v1/auth/login")
                                        .with(csrf())
                                        .contentType("application/json")
                                        .content(
                                                "{\"username\":\"department\",\"password\":\"testPassword123!\"}"))
                        .andExpect(status().isOk())
                        .andReturn();
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        mvc.perform(get("/api/v1/auth/me").session(session))
                .andExpect(jsonPath("$.data.role").value("DEPARTMENT"));
        mvc.perform(
                        put("/api/v1/settings/sourcePassword")
                                .with(user("admin"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"value\":\"secret\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/users").with(user("pilot"))).andExpect(status().isForbidden());
    }

    @Test
    void pilotCannotReadUnassignedPlansCasesOrConsultations() throws Exception {
        FlightPlan plan = new FlightPlan();
        plan.title = "部门计划";
        plan.kind = "DAILY";
        plan.region = "杭州市";
        plan.organizationId = organizationId;
        plan.status = "DRAFT";
        plan.createdBy = users.findByUsername("department").orElseThrow().id;
        plans.save(plan);
        IndustryCase industryCase = new IndustryCase();
        industryCase.title = "部门线索";
        industryCase.region = "杭州市";
        industryCase.organizationId = organizationId;
        industryCase.status = "PENDING_REVIEW";
        industryCase.createdBy = plan.createdBy;
        cases.save(industryCase);
        Consultation consultation = new Consultation();
        consultation.title = "部门咨询";
        consultation.region = "杭州市";
        consultation.organizationId = organizationId;
        consultation.status = "OPEN";
        consultation.createdBy = plan.createdBy;
        consultations.save(consultation);
        mvc.perform(get("/api/v1/plans/" + plan.id).with(user("pilot")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/cases/" + industryCase.id).with(user("pilot")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/consultations/" + consultation.id).with(user("pilot")))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/plans").with(user("pilot")))
                .andExpect(jsonPath("$.data.total").value(0));
        plan.createdBy = pilotId;
        plans.save(plan);
        mvc.perform(get("/api/v1/plans/" + plan.id).with(user("pilot"))).andExpect(status().isOk());
    }

    @Test
    void searchAndPagingHaveStableContracts() throws Exception {
        createTask("山林巡查");
        mvc.perform(get("/api/v1/tasks").param("keyword", "山林").with(user("department")))
                .andExpect(jsonPath("$.data.total").value(1));
        mvc.perform(get("/api/v1/tasks").param("keyword", "不存在").with(user("department")))
                .andExpect(jsonPath("$.data.total").value(0));
        mvc.perform(get("/api/v1/tasks").param("page", "2147483647").with(user("department")))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/v1/missing").with(user("admin")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    void cannotRegisterTheSamePhysicalDeviceTwice() throws Exception {
        String payload =
                "{\"title\":\"重复设备\",\"kind\":\"DEVICE\",\"region\":\"杭州市\",\"sourceDeviceId\":\"9007199254740993123\"}";
        mvc.perform(
                        post("/api/v1/resources")
                                .with(user("admin"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(payload))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DUPLICATE_SOURCE_DEVICE"));
    }

    @Test
    void returnedTaskCanBeEditedWithoutTrustingClientStatusFields() throws Exception {
        String id = createTask("原始申请");
        action(id, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        action(id, "dispatch", "{\"action\":\"RETURN\",\"note\":\"请补正材料\"}", "RETURNED");
        String input = payload("补正后的申请");
        input =
                input.substring(0, input.length() - 1)
                        + ",\"id\":\""
                        + id
                        + "\",\"status\":\"COMPLETED\",\"createdAt\":\"2026-10-14T01:00:00Z\"}";
        mvc.perform(
                        put("/api/v1/tasks/" + id)
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(input))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("补正后的申请"))
                .andExpect(jsonPath("$.data.status").value("RETURNED"));
        action(id, "department", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
    }

    @Test
    void dispatchCanHandleOnlyExplicitlyGrantedOrganizationsAndDevices() throws Exception {
        String foreignBody =
                mvc.perform(
                                post("/api/v1/tasks")
                                        .with(user("outsider"))
                                        .with(csrf())
                                        .contentType("application/json")
                                        .content(payload("外部门需求")))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String foreignTaskId = json.readTree(foreignBody).path("data").path("id").asText();
        mvc.perform(get("/api/v1/tasks/" + foreignTaskId).with(user("dispatch")))
                .andExpect(status().isForbidden());
        Resource foreignDevice = new Resource();
        foreignDevice.title = "授权部门设备";
        foreignDevice.kind = "DEVICE";
        foreignDevice.status = "ACTIVE";
        foreignDevice.region = "杭州市";
        foreignDevice.organizationId = otherOrganizationId;
        foreignDevice.sourceDeviceId = "9007199254740993999";
        resources.save(foreignDevice);
        UserAccount foreignPilot =
                account("foreign-pilot", Role.PILOT, otherOrganizationId, foreignDevice.id);
        UserAccount operator = users.findByUsername("dispatch").orElseThrow();
        String grant =
                "{\"username\":\"dispatch\",\"displayName\":\"调度员\",\"role\":\"DISPATCH\",\"organizationId\":\""
                        + organizationId
                        + "\",\"regions\":[\"杭州市\"],\"deviceIds\":[\""
                        + deviceId
                        + "\"],\"organizationIds\":[\""
                        + otherOrganizationId
                        + "\"]}";
        mvc.perform(
                        put("/api/v1/users/" + operator.id)
                                .with(user("admin"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(grant))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.organizationIds[0]").value(otherOrganizationId));
        mvc.perform(get("/api/v1/auth/me").with(user("dispatch")))
                .andExpect(jsonPath("$.data.organizationIds[0]").value(otherOrganizationId));
        mvc.perform(get("/api/v1/tasks/" + foreignTaskId).with(user("dispatch")))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/resources/" + foreignDevice.id).with(user("dispatch")))
                .andExpect(status().isForbidden());
        operator = users.findByUsername("dispatch").orElseThrow();
        operator.deviceIds += "," + foreignDevice.id;
        users.save(operator);
        mvc.perform(get("/api/v1/resources/" + foreignDevice.id).with(user("dispatch")))
                .andExpect(status().isOk());
        action(foreignTaskId, "outsider", "{\"action\":\"SUBMIT\"}", "PENDING_ASSIGNMENT");
        action(
                foreignTaskId,
                "dispatch",
                "{\"action\":\"ASSIGN\",\"deviceId\":\""
                        + foreignDevice.id
                        + "\",\"pilotId\":\""
                        + foreignPilot.id
                        + "\"}",
                "PENDING_EXECUTION");
        Task outsideRegion = new Task();
        outsideRegion.title = "区域外需求";
        outsideRegion.organizationId = otherOrganizationId;
        outsideRegion.region = "宁波市";
        outsideRegion.status = "DRAFT";
        tasks.save(outsideRegion);
        mvc.perform(get("/api/v1/tasks/" + outsideRegion.id).with(user("dispatch")))
                .andExpect(status().isForbidden());
        operator.organizationIds = "";
        users.save(operator);
        mvc.perform(get("/api/v1/tasks/" + foreignTaskId).with(user("dispatch")))
                .andExpect(status().isForbidden());
    }

    @Test
    void grantsValidateOrganizationsAndCannotExpandDepartmentScope() throws Exception {
        UserAccount outsider = users.findByUsername("outsider").orElseThrow();
        outsider.organizationIds = organizationId;
        users.save(outsider);
        String taskId = createTask("本组织隔离需求");
        mvc.perform(get("/api/v1/tasks/" + taskId).with(user("outsider")))
                .andExpect(status().isForbidden());
        String invalid =
                "{\"username\":\"new-dispatch\",\"password\":\"newTestPassword123!\",\"displayName\":\"新调度员\",\"role\":\"DISPATCH\",\"organizationId\":\""
                        + organizationId
                        + "\",\"organizationIds\":[\"missing-organization\"]}";
        mvc.perform(
                        post("/api/v1/users")
                                .with(user("admin"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(invalid))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        post("/api/v1/users")
                                .with(user("dispatch"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(invalid))
                .andExpect(status().isForbidden());
    }

    @Test
    void dashboardCountsAndCaseExclusionCoverAllVisibleRowsBeforePagination() throws Exception {
        List<IndustryCase> records = new ArrayList<>();
        for (int index = 0; index < 125; index++) {
            IndustryCase record = new IndustryCase();
            record.title = "分页线索" + index;
            record.organizationId = organizationId;
            record.region = "杭州市";
            record.status =
                    index < 3 ? "PENDING_REVIEW" : index < 5 ? "PENDING_DISPOSAL" : "ARCHIVED";
            records.add(record);
        }
        IndustryCase foreign = new IndustryCase();
        foreign.title = "不可见外组织线索";
        foreign.organizationId = otherOrganizationId;
        foreign.region = "杭州市";
        foreign.status = "PENDING_REVIEW";
        records.add(foreign);
        cases.saveAllAndFlush(records);
        for (String state : List.of("DRAFT", "APPROVED", "RETURNED")) {
            FlightPlan plan = new FlightPlan();
            plan.title = "统计计划";
            plan.kind = "DAILY";
            plan.status = state;
            plan.region = "杭州市";
            plan.organizationId = organizationId;
            plans.save(plan);
        }
        mvc.perform(get("/api/v1/dashboard").with(user("department")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.caseCounts.ARCHIVED").value(120))
                .andExpect(jsonPath("$.data.caseCounts.PENDING_REVIEW").value(3))
                .andExpect(jsonPath("$.data.caseCounts.PENDING_DISPOSAL").value(2))
                .andExpect(jsonPath("$.data.openCases").value(5))
                .andExpect(jsonPath("$.data.planCounts.DRAFT").value(1))
                .andExpect(jsonPath("$.data.planCounts.APPROVED").value(1))
                .andExpect(jsonPath("$.data.planCounts.RETURNED").value(1));
        mvc.perform(
                        get("/api/v1/cases")
                                .param("excludeStatus", "ARCHIVED")
                                .param("pageSize", "2")
                                .param("page", "2")
                                .with(user("department")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(5))
                .andExpect(jsonPath("$.data.items.length()").value(2))
                .andExpect(jsonPath("$.data.items[?(@.status == 'ARCHIVED')]").isEmpty());
        mvc.perform(
                        get("/api/v1/cases")
                                .param("status", "ARCHIVED")
                                .param("pageSize", "100")
                                .with(user("department")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(120))
                .andExpect(jsonPath("$.data.items.length()").value(100));
    }

    @Test
    void resolvingArchivesWithHumanConclusionAndKeepsLegacyArchiveCompatibility() throws Exception {
        IndustryCase current = new IndustryCase();
        current.title = "待处置线索";
        current.scene = "森林防火";
        current.organizationId = organizationId;
        current.region = "杭州市";
        current.status = "PENDING_DISPOSAL";
        cases.save(current);
        mvc.perform(
                        post("/api/v1/cases/" + current.id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content(
                                        "{\"action\":\"RESOLVE\",\"conclusion\":\"现场已处理并确认无持续风险\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("ARCHIVED"))
                .andExpect(jsonPath("$.data.conclusion").value("现场已处理并确认无持续风险"));
        assertThat(
                        events.findAll().stream()
                                .filter(
                                        event ->
                                                "CASE".equals(event.entityType)
                                                        && current.id.equals(event.entityId)
                                                        && "RESOLVE".equals(event.action))
                                .map(event -> event.note)
                                .toList())
                .containsExactly("现场已处理并确认无持续风险");
        mvc.perform(
                        post("/api/v1/cases/" + current.id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"ARCHIVE\"}"))
                .andExpect(status().isConflict());
        IndustryCase legacy = new IndustryCase();
        legacy.title = "历史已处置线索";
        legacy.organizationId = organizationId;
        legacy.region = "杭州市";
        legacy.status = "RESOLVED";
        legacy.conclusion = "历史人工处置结论";
        cases.save(legacy);
        mvc.perform(
                        post("/api/v1/cases/" + legacy.id + "/actions")
                                .with(user("department"))
                                .with(csrf())
                                .contentType("application/json")
                                .content("{\"action\":\"ARCHIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("ARCHIVED"))
                .andExpect(jsonPath("$.data.conclusion").value("历史人工处置结论"));
    }
}
