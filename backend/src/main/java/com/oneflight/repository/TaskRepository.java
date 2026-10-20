package com.oneflight.repository;

import com.oneflight.domain.Task;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

public interface TaskRepository extends JpaRepository<Task, String> {
    List<Task> findByPlanIdAndPilotId(String planId, String pilotId);

    List<Task> findByPlanId(String planId);

    Optional<Task> findByPlanCreationPlanIdAndPlanCreationRequestId(String planId, String requestId);

    @Query("select t from Task t where t.id <> :taskId "
            + "and t.status in ('PENDING_EXECUTION', 'EXECUTING') "
            + "and t.startAt < :endAt and t.endAt > :startAt")
    List<Task> findAssignmentOverlaps(
            @Param("taskId") String taskId,
            @Param("startAt") Instant startAt,
            @Param("endAt") Instant endAt);
}
