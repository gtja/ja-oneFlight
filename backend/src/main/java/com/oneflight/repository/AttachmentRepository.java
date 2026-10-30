package com.oneflight.repository;

import com.oneflight.domain.Attachment;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AttachmentRepository extends JpaRepository<Attachment, String> {
    java.util.List<Attachment> findByEntityId(String entityId);

    java.util.List<Attachment> findByEntityIdAndEntityType(String entityId, String entityType);

    java.util.List<Attachment> findByCaseId(String caseId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select attachment from Attachment attachment where attachment.id = :id")
    java.util.Optional<Attachment> findByIdForUpdate(@Param("id") String id);
}
