package com.oneflight.repository;

import com.oneflight.domain.AttachmentShareRequest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;

public interface AttachmentShareRequestRepository
        extends JpaRepository<AttachmentShareRequest, String> {
    List<AttachmentShareRequest> findByStatusAndExpiresAtAfter(String status, Instant instant);
}
