package com.oneflight.repository;

import com.oneflight.domain.SourceMediaLink;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SourceMediaLinkRepository extends JpaRepository<SourceMediaLink, String> {
    Optional<SourceMediaLink> findBySourceSystemAndSourceDeviceIdAndSourceMediaId(
            String sourceSystem, String sourceDeviceId, String sourceMediaId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select link from SourceMediaLink link where link.sourceSystem = :sourceSystem "
            + "and link.sourceDeviceId = :sourceDeviceId and link.sourceMediaId = :sourceMediaId")
    Optional<SourceMediaLink> findByIdentityForUpdate(
            @Param("sourceSystem") String sourceSystem,
            @Param("sourceDeviceId") String sourceDeviceId,
            @Param("sourceMediaId") String sourceMediaId);

    List<SourceMediaLink> findByCaseId(String caseId);

    List<SourceMediaLink> findByTaskId(String taskId);
}
