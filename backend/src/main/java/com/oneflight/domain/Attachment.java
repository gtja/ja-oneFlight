package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "attachment")
public class Attachment {
    @Id
    @Column(length = 36)
    public String id = UUID.randomUUID().toString();

    @Column(nullable = false, length = 36)
    public String organizationId;

    @Column(length = 80)
    public String region;

    @Column(nullable = false, length = 36)
    public String uploadedBy;

    @Column(nullable = false, length = 36)
    public String entityId;

    @Column(nullable = false, length = 30)
    public String entityType;

    @Column(name = "case_id", length = 36)
    public String caseId;

    @Column(nullable = false, length = 255)
    public String filename;

    @Column(nullable = false, length = 120)
    public String contentType;

    public long size;
    public Instant createdAt = Instant.now();

    @Column(name = "quality_status", nullable = false, length = 32)
    public String qualityStatus = "PENDING_REVIEW";

    @Column(name = "quality_note", length = 2000)
    public String qualityNote;

    @Column(name = "reviewed_by", length = 36)
    public String reviewedBy;

    @Column(name = "reviewed_at")
    public Instant reviewedAt;

    @Column(name = "archived_by", length = 36)
    public String archivedBy;

    @Column(name = "archived_at")
    public Instant archivedAt;

    public Map<String, Object> view() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("id", id);
        fields.put("entityId", entityId);
        fields.put("entityType", entityType);
        fields.put("filename", filename);
        fields.put("fileName", filename);
        fields.put("title", filename);
        fields.put("taskId", "TASK".equals(entityType) ? entityId : null);
        fields.put("caseId", "CASE".equals(entityType) ? entityId : caseId);
        fields.put("clueCandidate", "CASE".equals(entityType) || caseId != null);
        fields.put("contentType", contentType);
        fields.put("size", size);
        fields.put("createdAt", createdAt);
        fields.put("qualityStatus", qualityStatus);
        fields.put("qualityNote", qualityNote);
        fields.put("reviewedAt", reviewedAt);
        fields.put("archivedAt", archivedAt);
        fields.put("downloadUrl", "/api/v1/attachments/" + id + "/content");
        return fields;
    }
}
