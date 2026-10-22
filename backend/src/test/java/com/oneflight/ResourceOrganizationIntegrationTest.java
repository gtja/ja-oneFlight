package com.oneflight;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.*;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ResourceOrganizationIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired UserAccountRepository users;
    @Autowired OrganizationRepository organizations;
    @Autowired ResourceRepository resources;
    @Autowired TaskRepository tasks;
    @Autowired FlightPlanRepository plans;
    @Autowired IndustryCaseRepository cases;
    @Autowired ConsultationRepository consultations;
    @Autowired AuditEventRepository events;
    @Autowired AttachmentRepository attachments;

    final ObjectMapper json = new ObjectMapper();
    Organization original;
    Organization destination;
    Resource device;
    UserAccount dispatcher;

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
        original = organization("原业务组织");
        destination = organization("一网统飞");
        device = new Resource();
        device.title = "机场1-M30T";
        device.kind = "DEVICE";
        device.status = "ACTIVE";
        device.organizationId = original.id;
        device.region = "余杭区";
        device.sourceDeviceId = "verified-source-aircraft";
        device.metadata = "{\"sourceOrganizationName\":\"原站组织\"}";
        device = resources.save(device);
        account("admin", Role.ADMIN, original.id);
        dispatcher = account("dispatch", Role.DISPATCH, original.id);
    }

    Organization organization(String title) {
        Organization organization = new Organization();
        organization.title = title;
        organization.status = "ACTIVE";
        organization.region = "杭州市";
        organization.organizationId = organization.id;
        return organizations.save(organization);
    }

    UserAccount account(String username, Role role, String organizationId) {
        UserAccount account = new UserAccount();
        account.username = username;
        account.displayName = username;
        account.passwordHash = "{noop}integration-only";
        account.role = role;
        account.organizationId = organizationId;
        account.regions = "余杭区";
        account.deviceIds = device.id;
        return users.save(account);
    }

    ResultActions update(String username, String organizationId, String region) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", device.title);
        body.put("kind", "DEVICE");
        body.put("region", region);
        if (organizationId != null) body.put("organizationId", organizationId);
        body.put("status", "ACTIVE");
        body.put("sourceDeviceId", device.sourceDeviceId);
        body.put("metadata", Map.of("sourceOrganizationName", "原站组织"));
        return mvc.perform(put("/api/v1/resources/" + device.id)
                .with(user(username)).with(csrf()).contentType("application/json")
                .content(json.writeValueAsString(body)));
    }

    void assertUnchanged(String organizationId) {
        Resource stored = resources.findById(device.id).orElseThrow();
        assertThat(stored.organizationId).isEqualTo(organizationId);
        assertThat(stored.region).isEqualTo("余杭区");
        assertThat(events.count()).isZero();
    }

    JsonNode option(JsonNode options, String id) {
        for (JsonNode option : options)
            if (id.equals(option.path("id").asText())) return option;
        throw new AssertionError("Assignment option is missing: " + id);
    }

    @Test
    void administratorUpdatePersistsTheSelectedOrganizationAndRegion() throws Exception {
        update("admin", destination.id, "西湖区").andExpect(status().isOk())
                .andExpect(jsonPath("$.data.organizationId").value(destination.id))
                .andExpect(jsonPath("$.data.region").value("西湖区"));
        Resource stored = resources.findById(device.id).orElseThrow();
        assertThat(stored.organizationId).isEqualTo(destination.id);
        assertThat(stored.region).isEqualTo("西湖区");
        assertThat(stored.sourceDeviceId).isEqualTo("verified-source-aircraft");
        assertThat(json.readTree(stored.metadata).path("sourceOrganizationName").asText())
                .isEqualTo("原站组织");
        assertThat(events.findAll()).singleElement().satisfies(event -> {
            assertThat(event.organizationId).isEqualTo(destination.id);
            assertThat(event.action).isEqualTo("UPDATE");
        });
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = "   ")
    void omittedOrBlankOrganizationKeepsExistingOwnership(String organizationId) throws Exception {
        update("admin", organizationId, "余杭区").andExpect(status().isOk())
                .andExpect(jsonPath("$.data.organizationId").value(original.id));
        assertThat(resources.findById(device.id).orElseThrow().organizationId).isEqualTo(original.id);
    }

    @Test
    void dispatcherCannotMoveADeviceOutsideGrantedOrganizations() throws Exception {
        update("dispatch", destination.id, "余杭区").andExpect(status().isForbidden());
        assertUnchanged(original.id);
    }

    @Test
    void dispatcherCannotMoveADeviceOutsideGrantedRegions() throws Exception {
        dispatcher.organizationIds = destination.id;
        users.save(dispatcher);
        update("dispatch", destination.id, "西湖区").andExpect(status().isForbidden());
        assertUnchanged(original.id);
    }

    @Test
    void dispatcherCannotClaimAnOriginallyInaccessibleDevice() throws Exception {
        device.organizationId = destination.id;
        resources.save(device);
        update("dispatch", original.id, "余杭区").andExpect(status().isForbidden());
        assertUnchanged(destination.id);
    }

    @Test
    void dispatcherWithBothOrganizationAndDeviceGrantsCanTransfer() throws Exception {
        dispatcher.organizationIds = destination.id;
        users.save(dispatcher);
        update("dispatch", " " + destination.id + " ", "余杭区").andExpect(status().isOk());
        assertThat(resources.findById(device.id).orElseThrow().organizationId).isEqualTo(destination.id);
    }

    @Test
    void correctedResourceOwnershipAllowsTheSameTaskToBeAssigned() throws Exception {
        UserAccount pilot = account("pilot", Role.PILOT, destination.id);
        FlightPlan plan = new FlightPlan();
        plan.title = "已通过飞行计划";
        plan.kind = "DAILY";
        plan.status = "APPROVED";
        plan.organizationId = destination.id;
        plan.region = "余杭区";
        plan.startAt = Instant.parse("2026-10-21T08:00:00Z");
        plan.endAt = Instant.parse("2026-10-21T11:00:00Z");
        plans.save(plan);
        Task task = new Task();
        task.title = "测试飞行计划 · 执行任务";
        task.status = "PENDING_ASSIGNMENT";
        task.organizationId = destination.id;
        task.region = "余杭区";
        task.startAt = Instant.parse("2026-10-21T09:00:00Z");
        task.endAt = Instant.parse("2026-10-21T10:00:00Z");
        task.planId = plan.id;
        tasks.save(task);
        String endpoint = "/api/v1/tasks/" + task.id + "/assignment-options";
        var before = json.readTree(mvc.perform(get(endpoint).with(user("admin")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .path("data");
        JsonNode blockedDevice = option(before.path("devices"), device.id);
        assertThat(blockedDevice.path("eligible").asBoolean()).isFalse();
        assertThat(blockedDevice.path("reasons").get(0).path("code").asText())
                .isEqualTo("DEVICE_ORGANIZATION");

        update("admin", destination.id, "余杭区").andExpect(status().isOk());

        var after = json.readTree(mvc.perform(get(endpoint).with(user("admin")))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString())
                .path("data");
        JsonNode allowedDevice = option(after.path("devices"), device.id);
        assertThat(allowedDevice.path("eligible").asBoolean()).isTrue();
        assertThat(allowedDevice.path("compatiblePilotCount").asInt()).isEqualTo(1);
        mvc.perform(post("/api/v1/tasks/" + task.id + "/actions")
                .with(user("admin")).with(csrf()).contentType("application/json")
                .content(json.writeValueAsString(Map.of("action", "ASSIGN",
                        "deviceId", device.id, "pilotId", pilot.id))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING_EXECUTION"));
        Task assigned = tasks.findById(task.id).orElseThrow();
        assertThat(assigned.deviceId).isEqualTo(device.id);
        assertThat(assigned.pilotId).isEqualTo(pilot.id);
        assertThat(assigned.planId).isEqualTo(plan.id);
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "inactive"})
    void destinationMustExistAndBeActive(String condition) throws Exception {
        String organizationId = "nonexistent-organization";
        if ("inactive".equals(condition)) {
            destination.status = "INACTIVE";
            organizations.save(destination);
            organizationId = destination.id;
        }
        update("admin", organizationId, "余杭区").andExpect(status().isBadRequest());
        assertUnchanged(original.id);
    }

    @Test
    void assignmentOptionsExposeLocalOrganizationNamesAndUnknownFallback() throws Exception {
        UserAccount pilot = account("pilot", Role.PILOT, destination.id);
        Resource orphan = new Resource();
        orphan.title = "历史缺失组织设备";
        orphan.kind = "DEVICE";
        orphan.status = "ACTIVE";
        orphan.organizationId = "missing-organization";
        resources.save(orphan);
        Task task = new Task();
        task.title = "组织核验任务";
        task.organizationId = destination.id;
        task.region = "余杭区";
        task.status = "PENDING_ASSIGNMENT";
        task.startAt = Instant.parse("2026-10-21T09:00:00Z");
        task.endAt = Instant.parse("2026-10-21T10:00:00Z");
        tasks.save(task);
        String response = mvc.perform(get("/api/v1/tasks/" + task.id + "/assignment-options")
                .with(user("admin")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.organizationName").value("一网统飞"))
                .andReturn().getResponse().getContentAsString();
        var data = json.readTree(response).path("data");
        assertThat(option(data.path("devices"), device.id).path("organizationName").asText())
                .isEqualTo("原业务组织");
        assertThat(option(data.path("devices"), orphan.id).path("organizationName").asText())
                .isEqualTo("组织信息不可用");
        assertThat(option(data.path("pilots"), pilot.id).path("organizationName").asText())
                .isEqualTo("一网统飞");
    }
}
