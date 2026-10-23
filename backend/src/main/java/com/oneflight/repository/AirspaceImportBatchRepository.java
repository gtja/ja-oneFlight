package com.oneflight.repository;

import com.oneflight.domain.AirspaceImportBatch;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;

public interface AirspaceImportBatchRepository extends JpaRepository<AirspaceImportBatch, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select b from AirspaceImportBatch b where b.id = :id")
    Optional<AirspaceImportBatch> findLockedById(@Param("id") String id);

    @Modifying
    @Query("delete from AirspaceImportBatch b where b.status = 'PREVIEW' and b.expiresAt < :now")
    int deleteExpiredPreviews(@Param("now") Instant now);
}
