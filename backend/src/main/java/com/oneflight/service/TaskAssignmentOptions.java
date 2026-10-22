package com.oneflight.service;

import java.time.Instant;
import java.util.List;
import java.util.Set;

/** Safe assignment DTOs omit account credentials and grants to unrelated devices. */
public record TaskAssignmentOptions(
        String taskId,
        String taskStatus,
        String region,
        String organizationId,
        String organizationName,
        Instant startAt,
        Instant endAt,
        String selectedDeviceId,
        Summary summary,
        List<DeviceOption> devices,
        List<PilotOption> pilots,
        List<TaskAssignmentPolicy.Reason> reasons) {

    public record Summary(
            long deviceCount,
            long activeDeviceCount,
            long pendingDeviceCount,
            long availableDeviceCount,
            long pilotCount,
            long availablePilotCount) {}

    public record DeviceOption(
            String id,
            String title,
            String status,
            String region,
            String organizationId,
            String organizationName,
            boolean eligible,
            List<TaskAssignmentPolicy.Reason> reasons,
            long compatiblePilotCount) {}

    public record PilotOption(
            String id,
            String title,
            String organizationId,
            String organizationName,
            Set<String> regions,
            boolean eligible,
            List<TaskAssignmentPolicy.Reason> reasons) {}
}
