package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.*;

@MappedSuperclass
public abstract class BaseRecord {
    @Id
    @Column(length = 36)
    public String id = UUID.randomUUID().toString();

    @Version public long version;

    @Column(nullable = false, length = 180)
    public String title;

    @Column(nullable = false, length = 40)
    public String status;

    @Column(length = 80)
    public String region;

    @Column(nullable = false, length = 36)
    public String organizationId;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    @Column(nullable = false)
    public Instant updatedAt = Instant.now();

    @Column(length = 36)
    public String createdBy;

    @Column(columnDefinition = "TEXT")
    public String provenance;

    public Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("title", title);
        m.put("status", status);
        m.put("region", region);
        m.put("organizationId", organizationId);
        m.put("createdAt", createdAt);
        m.put("updatedAt", updatedAt);
        m.put("createdBy", createdBy);
        m.put("provenance", com.oneflight.common.RecordProvenance.view(provenance));
        return m;
    }

    @PreUpdate
    public void beforeUpdate() {
        updatedAt = Instant.now();
    }
}
