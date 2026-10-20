package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.*;

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

import java.time.Instant;
import java.util.List;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TaskAssignmentOptionsIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired TaskRepository tasks;
    @Autowired ResourceRepository resources;
    @Autowired UserAccountRepository users;
    @Autowired OrganizationRepository organizations;
    @Autowired FlightPlanRepository plans;
    @Autowired IndustryCaseRepository cases;
    @Autowired ConsultationRepository consultations;
    @Autowired AttachmentRepository attachments;
    @Autowired AuditEventRepository events;
    ObjectMapper json = new ObjectMapper();
    Organization organization;
    Organization otherOrganization;
    Resource device;
    UserAccount pilot;
    UserAccount dispatcher;
    Task task;

    @BeforeEach
    void fixture() {
        attachments.deleteAll();
        events.deleteAll();
        cases.deleteAll();
        consultations.deleteAll();
        tasks.deleteAll();
        plans.deleteAll();
        resources.deleteAll();
        users.deleteAll();
        organizations.deleteAll();
        organization = organization("平台运营中心");
        otherOrganization = organization("其他组织");
        device = device("执行设备", "ACTIVE", organization.id);
        account("admin", Role.ADMIN, organization.id, "", "");
        dispatcher = account("dispatch", Role.DISPATCH, organization.id, "余杭区,西湖区", device.id);
        pilot = account("pilot", Role.PILOT, organization.id, "西湖区", device.id);
        account("department", Role.DEPARTMENT, organization.id, "余杭区,西湖区", device.id);
        task = task("待分配任务", "PENDING_ASSIGNMENT", device.id, pilot.id);
        task.deviceId = null;
        task.pilotId = null;
        task = tasks.save(task);
    }

    Organization organization(String title) {
        Organization result = new Organization();
        result.title = title;
        result.status = "ACTIVE";
        result.region = "杭州市";
        result.organizationId = result.id;
        return organizations.save(result);
    }

    Resource device(String title, String state, String organizationId) {
        Resource result = new Resource();
        result.title = title;
        result.status = state;
        result.kind = "DEVICE";
        result.region = "余杭区";
        result.organizationId = organizationId;
        result.sourceDeviceId = "9007199254740993123-" + result.id;
        return resources.save(result);
    }

    UserAccount account(String name, Role role, String organizationId, String regions, String grants) {
        UserAccount result = new UserAccount();
        result.username = name;
        result.displayName = name;
        result.passwordHash = "{noop}integration-only";
        result.role = role;
        result.organizationId = organizationId;
        result.regions = regions;
        result.deviceIds = grants;
        return users.save(result);
    }

    Task task(String title, String state, String deviceId, String pilotId) {
        Task result = new Task();
        result.title = title;
        result.status = state;
        result.region = "西湖区";
        result.organizationId = organization.id;
        result.createdBy = users.findByUsername("department").orElseThrow().id;
        result.startAt = Instant.parse("2026-10-15T01:00:00Z");
        result.endAt = Instant.parse("2026-10-15T02:00:00Z");
        result.deviceId = deviceId;
        result.pilotId = pilotId;
        return tasks.save(result);
    }

    JsonNode options(String username, String selectedDevice) throws Exception {
        var request = get("/api/v1/tasks/" + task.id + "/assignment-options").with(user(username));
        if (selectedDevice != null) request.param("deviceId", selectedDevice);
        return json.readTree(mvc.perform(request).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).path("data");
    }

    JsonNode candidate(JsonNode data, String collection, String id) {
        for (JsonNode option : data.path(collection))
            if (id.equals(option.path("id").asText())) return option;
        throw new AssertionError("Candidate is missing: " + id);
    }

    List<String> codes(JsonNode option) {
        return java.util.stream.StreamSupport.stream(option.path("reasons").spliterator(), false)
                .map(reason -> reason.path("code").asText()).toList();
    }

    org.springframework.test.web.servlet.ResultActions assign(String username, String deviceId, String pilotId) throws Exception {
        return mvc.perform(post("/api/v1/tasks/" + task.id + "/actions")
                .with(user(username)).with(csrf()).contentType("application/json")
                .content("{\"action\":\"ASSIGN\",\"deviceId\":\"" + deviceId
                        + "\",\"pilotId\":\"" + pilotId + "\"}"));
    }

    @Test
    void allowedPairWorksEvenWhenDeviceStationDiffersFromTaskArea() throws Exception {
        JsonNode result = options("dispatch", device.id);
        assertThat(result.path("region").asText()).isEqualTo("西湖区");
        assertThat(candidate(result, "devices", device.id).path("region").asText()).isEqualTo("余杭区");
        assertThat(candidate(result, "devices", device.id).path("eligible").asBoolean()).isTrue();
        assertThat(candidate(result, "devices", device.id).path("compatiblePilotCount").asInt()).isEqualTo(1);
        assertThat(candidate(result, "pilots", pilot.id).path("eligible").asBoolean()).isTrue();
        assign("dispatch", device.id, pilot.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING_EXECUTION"));
    }

    @Test
    void pendingArchivesAreCountedAndExplainedWithoutBeingActivated() throws Exception {
        Resource pending = device("待确认设备", "PENDING_CONFIRMATION", organization.id);
        JsonNode result = options("admin", device.id);
        assertThat(result.path("summary").path("deviceCount").asInt()).isEqualTo(2);
        assertThat(result.path("summary").path("activeDeviceCount").asInt()).isEqualTo(1);
        assertThat(result.path("summary").path("pendingDeviceCount").asInt()).isEqualTo(1);
        assertThat(codes(candidate(result, "devices", pending.id))).containsExactly("DEVICE_PENDING_CONFIRMATION");
        assertThat(resources.findById(pending.id).orElseThrow().status).isEqualTo("PENDING_CONFIRMATION");
        assertThat(tasks.findById(task.id).orElseThrow().status).isEqualTo("PENDING_ASSIGNMENT");
        assertThat(events.count()).isZero();
    }

    @Test
    void outOfAreaPilotExplainsBothAreasAndCannotBeAssigned() throws Exception {
        pilot.regions = "余杭区";
        users.save(pilot);
        JsonNode result = options("admin", device.id);
        JsonNode option = candidate(result, "pilots", pilot.id);
        assertThat(codes(option)).containsExactly("PILOT_REGION");
        assertThat(option.path("reasons").get(0).path("message").asText()).contains("余杭区", "西湖区");
        assertThat(result.path("summary").path("availableDeviceCount").asInt()).isZero();
        assertThat(candidate(result, "devices", device.id).path("eligible").asBoolean()).isTrue();
        assertThat(candidate(result, "devices", device.id).path("compatiblePilotCount").asInt()).isZero();
        assign("admin", device.id, pilot.id).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("西湖区")));
        pilot.regions = "余杭区,西湖区";
        users.save(pilot);
        assertThat(candidate(options("admin", device.id), "pilots", pilot.id)
                .path("eligible").asBoolean()).isTrue();
        assign("admin", device.id, pilot.id).andExpect(status().isOk());
    }

    @ParameterizedTest
    @CsvSource({"disabled,PILOT_DISABLED", "organization,PILOT_ORGANIZATION", "grant,PILOT_DEVICE"})
    void pilotReasonsMatchFinalAssignmentChecks(String change, String code) throws Exception {
        switch (change) {
            case "disabled" -> pilot.enabled = false;
            case "organization" -> pilot.organizationId = otherOrganization.id;
            case "grant" -> pilot.deviceIds = "unrelated-device";
            default -> throw new AssertionError(change);
        }
        users.save(pilot);
        JsonNode result = options("admin", device.id);
        assertThat(codes(candidate(result, "pilots", pilot.id))).containsExactly(code);
        assign("admin", device.id, pilot.id).andExpect(status().isBadRequest());
        assertThat(tasks.findById(task.id).orElseThrow().status).isEqualTo("PENDING_ASSIGNMENT");
    }

    @Test
    void selectedDeviceChangesPilotEligibilityAndSourceIdGrantsWork() throws Exception {
        Resource second = device("另一设备", "ACTIVE", organization.id);
        assertThat(candidate(options("admin", null), "pilots", pilot.id).path("eligible").asBoolean()).isTrue();
        assertThat(codes(candidate(options("admin", second.id), "pilots", pilot.id))).containsExactly("PILOT_DEVICE");
        pilot.deviceIds = second.sourceDeviceId;
        users.save(pilot);
        JsonNode result = options("admin", second.id);
        assertThat(candidate(result, "pilots", pilot.id).path("eligible").asBoolean()).isTrue();
        assertThat(result.path("selectedDeviceId").asText()).isEqualTo(second.id);
        assign("admin", second.id, pilot.id).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"department", "pilot"})
    void onlyAdministratorsAndDispatchersSeeAssignmentOptions(String username) throws Exception {
        mvc.perform(get("/api/v1/tasks/" + task.id + "/assignment-options").with(user(username)))
                .andExpect(status().isForbidden());
    }

    @Test
    void hiddenDevicesAndOrganizationsDoNotLeakThroughOptions() throws Exception {
        Resource hidden = device("未授权设备", "ACTIVE", organization.id);
        Resource foreign = device("其他组织设备", "ACTIVE", otherOrganization.id);
        account("foreign-pilot", Role.PILOT, otherOrganization.id, "西湖区", foreign.id);
        JsonNode result = options("dispatch", device.id);
        assertThat(result.path("summary").path("deviceCount").asInt()).isEqualTo(1);
        assertThat(result.path("summary").path("pilotCount").asInt()).isEqualTo(1);
        assertThat(result.toString()).doesNotContain(hidden.id, foreign.id, "foreign-pilot", "passwordHash", "deviceIds");
        mvc.perform(get("/api/v1/tasks/" + task.id + "/assignment-options")
                .with(user("dispatch")).param("deviceId", hidden.id)).andExpect(status().isForbidden());
        assign("dispatch", hidden.id, pilot.id).andExpect(status().isForbidden());
        task.organizationId = otherOrganization.id;
        tasks.save(task);
        mvc.perform(get("/api/v1/tasks/" + task.id + "/assignment-options").with(user("dispatch")))
                .andExpect(status().isForbidden());
    }

    @ParameterizedTest
    @ValueSource(strings = {"DEVICE", "PILOT"})
    void overlappingBusyResourcesAreRejectedByChoicesAndAssignment(String busyResource) throws Exception {
        String busyDevice = "DEVICE".equals(busyResource) ? device.id : "other-device";
        String busyPilot = "PILOT".equals(busyResource) ? pilot.id : "other-pilot";
        task("进行中的另一任务", "EXECUTING", busyDevice, busyPilot);
        JsonNode result = options("admin", device.id);
        JsonNode option = candidate(result, "DEVICE".equals(busyResource) ? "devices" : "pilots",
                "DEVICE".equals(busyResource) ? device.id : pilot.id);
        assertThat(codes(option)).contains(busyResource + "_CONFLICT");
        assign("admin", device.id, pilot.id).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESOURCE_CONFLICT"));
    }

    @Test
    void adjacentIntervalsAndCompletedWorkDoNotReserveResources() throws Exception {
        Task earlier = task("相邻时段", "PENDING_EXECUTION", device.id, pilot.id);
        earlier.startAt = task.startAt.minusSeconds(3600);
        earlier.endAt = task.startAt;
        tasks.save(earlier);
        task("已完成任务", "COMPLETED", device.id, pilot.id);
        assertThat(options("admin", device.id).path("summary").path("availableDeviceCount").asInt()).isEqualTo(1);
        assign("admin", device.id, pilot.id).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"PENDING_EXECUTION", "COMPLETED", "CANCELLED"})
    void tasksThatCannotBeAssignedFailClosed(String state) throws Exception {
        task.status = state;
        tasks.save(task);
        JsonNode result = options("admin", device.id);
        assertThat(codes(result)).containsExactly("TASK_STATE");
        assertThat(candidate(result, "devices", device.id).path("eligible").asBoolean()).isFalse();
        assertThat(candidate(result, "pilots", pilot.id).path("eligible").asBoolean()).isFalse();
        assign("admin", device.id, pilot.id).andExpect(status().isConflict());
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "reversed"})
    void incompleteOrReversedIntervalsFailClosed(String interval) throws Exception {
        task.endAt = "missing".equals(interval) ? null : task.startAt.minusSeconds(1);
        tasks.save(task);
        JsonNode result = options("admin", device.id);
        assertThat(codes(result)).containsExactly("TASK_TIME");
        assertThat(result.path("summary").path("availableDeviceCount").asInt()).isZero();
        assign("admin", device.id, pilot.id).andExpect(status().isBadRequest());
    }

    @Test
    void changedStatusAfterReadingOptionsIsRecheckedOnAssignment() throws Exception {
        assertThat(candidate(options("admin", device.id), "devices", device.id).path("eligible").asBoolean()).isTrue();
        device.status = "MAINTENANCE";
        resources.save(device);
        assign("admin", device.id, pilot.id).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("设备当前未启用，不能分配"));
        assertThat(tasks.findById(task.id).orElseThrow().deviceId).isNull();
    }

    @Test
    void changedGrantAfterReadingOptionsIsRecheckedOnAssignment() throws Exception {
        assertThat(candidate(options("admin", device.id), "pilots", pilot.id).path("eligible").asBoolean()).isTrue();
        pilot.deviceIds = "";
        users.save(pilot);
        assign("admin", device.id, pilot.id).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("飞手未授权使用所选设备"));
        assertThat(events.count()).isZero();
    }
}
