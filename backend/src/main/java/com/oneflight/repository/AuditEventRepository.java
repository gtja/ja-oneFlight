package com.oneflight.repository;

import com.oneflight.domain.AuditEvent;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditEventRepository extends JpaRepository<AuditEvent, String> {}
