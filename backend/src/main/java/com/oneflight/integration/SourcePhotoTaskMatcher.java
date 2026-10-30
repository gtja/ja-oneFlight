package com.oneflight.integration;

import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;

/** Matches source capture intervals to the assigned device's scheduled task interval. */
public final class SourcePhotoTaskMatcher {
    private SourcePhotoTaskMatcher() {}

    public record Candidate(
            String taskId,
            String title,
            String sourceDeviceId,
            String status,
            Instant startAt,
            Instant endAt) {}

    public static List<Candidate> candidates(
            String sourceDeviceId,
            Instant capturedFrom,
            Instant capturedTo,
            Collection<Candidate> tasks) {
        if (blank(sourceDeviceId) || capturedFrom == null || tasks == null) return List.of();
        Instant end = capturedTo == null ? capturedFrom : capturedTo;
        if (end.isBefore(capturedFrom)) return List.of();
        return tasks.stream()
                .filter(Objects::nonNull)
                .filter(task -> Objects.equals(sourceDeviceId, task.sourceDeviceId()))
                .filter(task -> !"CANCELLED".equals(task.status()))
                .filter(task -> task.startAt() != null && task.endAt() != null
                        && task.endAt().isAfter(task.startAt()))
                .filter(task -> capturedFrom.equals(end)
                        ? !capturedFrom.isBefore(task.startAt()) && capturedFrom.isBefore(task.endAt())
                        : task.startAt().isBefore(end) && task.endAt().isAfter(capturedFrom))
                .sorted(Comparator.comparing(Candidate::startAt).thenComparing(Candidate::taskId))
                .toList();
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
