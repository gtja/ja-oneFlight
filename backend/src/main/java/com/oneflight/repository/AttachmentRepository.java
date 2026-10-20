package com.oneflight.repository;

import com.oneflight.domain.Attachment;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AttachmentRepository extends JpaRepository<Attachment, String> {
    java.util.List<Attachment> findByEntityId(String entityId);
}
