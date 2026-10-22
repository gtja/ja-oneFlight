package com.oneflight.service;

import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.UserAccountRepository;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Assembles visible assignment choices within the workflow's read-only transaction. */
@Component
public class TaskAssignmentOptionsQuery {
    private static final String UNKNOWN_ORGANIZATION_NAME = "组织信息不可用";

    private final OrganizationRepository organizations;
    private final ResourceRepository resources;
    private final UserAccountRepository users;
    private final ScopeService scope;
    private final TaskAssignmentPolicy assignmentPolicy;

    public TaskAssignmentOptionsQuery(
            OrganizationRepository organizations,
            ResourceRepository resources,
            UserAccountRepository users,
            ScopeService scope,
            TaskAssignmentPolicy assignmentPolicy) {
        this.organizations = organizations;
        this.resources = resources;
        this.users = users;
        this.scope = scope;
        this.assignmentPolicy = assignmentPolicy;
    }

    TaskAssignmentOptions forTask(
            Task task, Resource selectedDevice, List<Task> overlaps) {
        Map<String, String> organizationNames = new HashMap<>();
        organizations.findAll().forEach(organization -> organizationNames.put(organization.id,
                organization.title == null || organization.title.isBlank()
                        ? UNKNOWN_ORGANIZATION_NAME : organization.title));
        List<Resource> visibleDevices = resources.findAll().stream()
                .filter(resource -> "DEVICE".equals(resource.kind) && scope.canRead(resource))
                .sorted(Comparator.comparing(resource -> resource.title,
                        Comparator.nullsLast(String::compareTo)))
                .toList();
        List<UserAccount> visiblePilots = users.findAll().stream()
                .filter(user -> user.role == Role.PILOT && scope.canAccess(user.organizationId, null))
                .sorted(Comparator.comparing(user -> user.displayName,
                        Comparator.nullsLast(String::compareTo)))
                .toList();
        List<TaskAssignmentOptions.DeviceOption> deviceOptions = new ArrayList<>(visibleDevices.size());
        long activeDeviceCount = 0;
        long pendingDeviceCount = 0;
        long availableDeviceCount = 0;
        for (Resource device : visibleDevices) {
            var reasons = assignmentPolicy.deviceReasons(task, device, overlaps);
            boolean eligible = reasons.isEmpty();
            long compatiblePilots = eligible
                    ? visiblePilots.stream().filter(pilot -> assignmentPolicy
                            .pilotReasons(task, pilot, device, overlaps).isEmpty()).count()
                    : 0L;
            deviceOptions.add(new TaskAssignmentOptions.DeviceOption(device.id, device.title,
                    device.status, device.region, device.organizationId,
                    organizationNames.getOrDefault(device.organizationId, UNKNOWN_ORGANIZATION_NAME),
                    eligible, reasons, compatiblePilots));
            if ("ACTIVE".equals(device.status)) activeDeviceCount++;
            if ("PENDING_CONFIRMATION".equals(device.status)) pendingDeviceCount++;
            if (eligible && compatiblePilots > 0) availableDeviceCount++;
        }
        List<TaskAssignmentOptions.PilotOption> pilotOptions = new ArrayList<>(visiblePilots.size());
        long availablePilotCount = 0;
        for (UserAccount pilot : visiblePilots) {
            var reasons = assignmentPolicy.pilotReasons(task, pilot, selectedDevice, overlaps);
            boolean eligible = reasons.isEmpty();
            pilotOptions.add(new TaskAssignmentOptions.PilotOption(pilot.id, pilot.displayName,
                    pilot.organizationId,
                    organizationNames.getOrDefault(pilot.organizationId, UNKNOWN_ORGANIZATION_NAME),
                    UserAccount.split(pilot.regions), eligible, reasons));
            if (eligible) availablePilotCount++;
        }
        var summary = new TaskAssignmentOptions.Summary(
                deviceOptions.size(), activeDeviceCount, pendingDeviceCount, availableDeviceCount,
                pilotOptions.size(), availablePilotCount);
        return new TaskAssignmentOptions(task.id, task.status, task.region, task.organizationId,
                organizationNames.getOrDefault(task.organizationId, UNKNOWN_ORGANIZATION_NAME),
                task.startAt, task.endAt, selectedDevice == null ? null : selectedDevice.id,
                summary, List.copyOf(deviceOptions), List.copyOf(pilotOptions), assignmentPolicy.taskReasons(task));
    }
}
