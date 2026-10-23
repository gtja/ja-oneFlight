package com.oneflight.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/** Immutable, actor-bound staging data; only commit creates business resources. */
@Entity
@Table(name = "airspace_import_batch")
public class AirspaceImportBatch {
    @Id @Column(length = 36)
    public String id = UUID.randomUUID().toString();
    @Column(nullable = false, length = 36)
    public String createdBy;
    @Column(nullable = false, length = 36)
    public String organizationId;
    @Column(nullable = false, length = 80)
    public String region;
    @Column(nullable = false, length = 20)
    public String status;
    @Column(nullable = false, length = 200)
    public String filename;
    @Column(nullable = false, length = 64)
    public String fileHash;
    @Column(nullable = false, length = 64)
    public String payloadHash;
    @Column(columnDefinition = "MEDIUMTEXT")
    public String normalizedPayload;
    @Column(columnDefinition = "TEXT")
    public String resultJson;
    @Column(nullable = false)
    public Instant createdAt;
    @Column(nullable = false)
    public Instant expiresAt;
    public Instant committedAt;
}
