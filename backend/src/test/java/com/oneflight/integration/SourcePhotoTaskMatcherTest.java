package com.oneflight.integration;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SourcePhotoTaskMatcherTest {
    private static final Instant FROM = Instant.parse("2026-10-29T02:00:00Z");
    private static final Instant TO = Instant.parse("2026-10-29T03:00:00Z");

    @Test
    void matchesOnlyTheSameSourceDeviceAndOverlappingScheduledWindow() {
        var expected = candidate("task-1", "device-A", "EXECUTING", FROM.minusSeconds(60), TO.plusSeconds(60));
        var otherDevice = candidate("task-2", "device-B", "EXECUTING", FROM.minusSeconds(60), TO.plusSeconds(60));
        var outsideWindow = candidate("task-3", "device-A", "COMPLETED", TO.plusSeconds(1), TO.plusSeconds(3600));
        var cancelled = candidate("task-4", "device-A", "CANCELLED", FROM.minusSeconds(60), TO.plusSeconds(60));

        assertEquals(List.of(expected), SourcePhotoTaskMatcher.candidates(
                "device-A", FROM, TO, List.of(otherDevice, outsideWindow, cancelled, expected)));
    }

    @Test
    void pointCaptureAtTaskStartMatchesAndAdjacentTaskAtEndDoesNot() {
        var startsAtCapture = candidate("task-1", "device-A", "PENDING_EXECUTION", FROM, TO);
        var priorTaskEndsAtCapture = candidate("task-2", "device-A", "COMPLETED", FROM.minusSeconds(3600), FROM);

        assertEquals(List.of(startsAtCapture), SourcePhotoTaskMatcher.candidates(
                "device-A", FROM, FROM, List.of(priorTaskEndsAtCapture, startsAtCapture)));
    }

    @Test
    void returnsZeroOrMultipleCandidatesInsteadOfGuessing() {
        var first = candidate("task-1", "device-A", "EXECUTING", FROM.minusSeconds(10), TO.plusSeconds(10));
        var second = candidate("task-2", "device-A", "PENDING_ACCEPTANCE", FROM.minusSeconds(10), TO.plusSeconds(10));

        assertTrue(SourcePhotoTaskMatcher.candidates("device-A", FROM, TO, List.of()).isEmpty());
        assertEquals(2, SourcePhotoTaskMatcher.candidates("device-A", FROM, TO, List.of(second, first)).size());
        assertTrue(SourcePhotoTaskMatcher.candidates("device-A", TO, FROM, List.of(first)).isEmpty());
    }

    private static SourcePhotoTaskMatcher.Candidate candidate(
            String taskId, String deviceId, String status, Instant startAt, Instant endAt) {
        return new SourcePhotoTaskMatcher.Candidate(taskId, taskId, deviceId, status, startAt, endAt);
    }
}
