package com.oneflight.web;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class AirspaceImportDtos {
    private AirspaceImportDtos() {}

    public record AirspaceProfile(String reference, Double lowerHeightMeters, Double upperHeightMeters) {}

    public record ImportOptions(
            @NotBlank @Size(max = 36) String organizationId,
            @NotBlank @Size(max = 80) String region,
            @NotBlank String coordinateReference,
            AirspaceProfile defaultAirspaceProfile) {}

    public record Issue(String code, String message) {}

    public record PreviewRow(int index, String title, String model, String description,
            Map<String, Object> geometry, AirspaceProfile airspaceProfile, int pointCount, boolean duplicate,
            List<Issue> errors, List<Issue> warnings) {}

    public record Summary(int total, int valid, int invalid, int duplicates, int pointCount) {}

    public record PreviewResult(String batchId, Instant expiresAt, boolean canCommit,
            Summary summary, List<PreviewRow> rows) {}

    public record CommitResult(String batchId, String status, int imported, int skipped,
            List<String> ids, String importedAt) {}
}
