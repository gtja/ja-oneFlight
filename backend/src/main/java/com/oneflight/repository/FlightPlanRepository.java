package com.oneflight.repository;

import com.oneflight.domain.FlightPlan;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;
import java.util.Optional;

public interface FlightPlanRepository extends JpaRepository<FlightPlan, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from FlightPlan p where p.id = :id")
    Optional<FlightPlan> findLockedById(@Param("id") String id);
}
