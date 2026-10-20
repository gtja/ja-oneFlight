package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "audit_event")
public class AuditEvent {
    @Id
    @Column(length = 36)
    public String id = UUID.randomUUID().toString();

    @Column(nullable = false, length = 36)
    public String actorId;

    @Column(length = 100)
    public String actorName;

    @Column(nullable = false, length = 80)
    public String action;

    @Column(length = 36)
    public String organizationId;

    @Column(length = 80)
    public String region;

    @Column(length = 80)
    public String entityType;

    @Column(length = 36)
    public String entityId;

    @Column(length = 2000)
    public String note;

    public Instant createdAt = Instant.now();

    public Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("actorId", actorId);
        m.put("actorName", actorName);
        m.put("action", action);
        m.put("organizationId", organizationId);
        m.put("region", region);
        m.put("entityType", entityType);
        m.put("entityId", entityId);
        m.put("note", note);
        m.put("createdAt", createdAt);
        return m;
    }
}
