package com.oneflight.web;

import com.oneflight.auth.Role;

import jakarta.validation.constraints.*;

import java.time.Instant;
import java.util.*;

public final class Requests {
    private Requests() {}

    public record TaskInput(
            @NotBlank @Size(max = 180) String title,
            @Size(max = 8000) String description,
            @NotBlank String scene,
            String priority,
            @NotBlank String region,
            String organizationId,
            @NotNull Instant startAt,
            @NotNull Instant endAt,
            String planId,
            @Size(max = 8000) String resultSummary,
            Map<String, Object> provenance) {}

    public record PlanInput(
            @NotBlank @Size(max = 180) String title,
            @NotBlank String kind,
            @NotBlank String region,
            String organizationId,
            @NotNull Instant startAt,
            @NotNull Instant endAt,
            @DecimalMin("0") @DecimalMax("12000") Double height,
            @Size(max = 8000) String scope,
            String resourceId,
            String taskId,
            String receiptNumber,
            @Size(max = 8000) String receiptBasis,
            String materialName,
            String materialNumber,
            java.time.LocalDate validFrom,
            java.time.LocalDate validUntil,
            Map<String, Object> provenance) {}

    public record PlanTaskInput(
            @NotBlank @Size(max = 180) String title,
            @Size(max = 8000) String description,
            @NotBlank @Size(max = 180) String scene,
            @Pattern(regexp = "NORMAL|HIGH|URGENT") String priority,
            @NotNull Instant startAt,
            @NotNull Instant endAt,
            @NotBlank @Pattern(regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}") String requestId) {}

    public record ResourceInput(
            @NotBlank @Size(max = 180) String title,
            @NotBlank String kind,
            @NotBlank String region,
            String organizationId,
            String status,
            String model,
            String sourceDeviceId,
            String productKey,
            String sn,
            @DecimalMin("-180") @DecimalMax("180") Double longitude,
            @DecimalMin("-90") @DecimalMax("90") Double latitude,
            Map<String, Object> metadata) {}

    public record CaseInput(
            @NotBlank @Size(max = 180) String title,
            @NotBlank String scene,
            @NotBlank String region,
            String organizationId,
            @Size(max = 8000) String description,
            String taskId,
            @Size(max = 8000) String conclusion,
            Map<String, Object> provenance) {}

    public record ConsultationInput(
            @NotBlank @Size(max = 180) String title,
            @NotBlank String region,
            String organizationId,
            String kind,
            @Size(max = 8000) String description,
            Map<String, Object> provenance) {}

    public record OrganizationInput(
            @NotBlank @Size(max = 180) String title,
            String region,
            String parentId,
            String contact) {}

    public record UserInput(
            @NotBlank @Size(max = 80) String username,
            @Size(min = 12, max = 128) String password,
            @NotBlank @Size(max = 100) String displayName,
            @NotNull Role role,
            @NotBlank String organizationId,
            Set<String> regions,
            Set<String> deviceIds,
            Boolean enabled,
            @Size(max = 500) Set<String> organizationIds,
            Map<String, Object> provenance) {}

    public record BusinessPermissionsInput(
            @NotNull Role role,
            @NotBlank String organizationId,
            Set<String> regions,
            Set<String> deviceIds,
            Boolean enabled,
            @Size(max = 500) Set<String> organizationIds) {}

    public record ActionInput(
            @NotBlank String action,
            @Size(max = 2000) String note,
            String deviceId,
            String pilotId,
            String planId,
            String receiptNumber,
            @Size(max = 8000) String receiptBasis,
            @Size(max = 8000) String resultSummary,
            @Size(max = 8000) String conclusion,
            @Size(max = 8000) String reply) {}

    public record SettingInput(@NotNull @Size(max = 8000) String value) {}
}
