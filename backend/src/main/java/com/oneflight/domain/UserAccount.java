package com.oneflight.domain;

import com.oneflight.auth.*;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "user_account")
public class UserAccount {
    @Id
    @Column(length = 36)
    public String id = UUID.randomUUID().toString();

    @Column(nullable = false, unique = true, length = 80)
    public String username;

    @Column(nullable = false, length = 100)
    public String passwordHash;

    @Column(nullable = false, length = 100)
    public String displayName;

    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.VARCHAR)
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    public Role role;

    @Column(nullable = false, length = 36)
    public String organizationId;

    @Column(columnDefinition = "TEXT")
    public String regions = "";

    @Column(columnDefinition = "TEXT")
    public String deviceIds = "";

    @Column(name = "allowed_organization_ids", columnDefinition = "TEXT")
    public String organizationIds = "";

    @Column(columnDefinition = "TEXT")
    public String provenance;

    public boolean enabled = true;
    public Instant createdAt = Instant.now();

    public static Set<String> split(String input) {
        return input == null || input.isBlank()
                ? Set.of()
                : Set.copyOf(Arrays.asList(input.split(",")));
    }

    public CurrentUser current() {
        return new CurrentUser(
                id,
                username,
                displayName,
                role,
                organizationId,
                split(regions),
                split(deviceIds),
                split(organizationIds));
    }

    public Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("username", username);
        m.put("displayName", displayName);
        m.put("title", displayName);
        m.put("role", role);
        m.put("organizationId", organizationId);
        m.put("regions", split(regions));
        m.put("deviceIds", split(deviceIds));
        m.put("organizationIds", split(organizationIds));
        m.put("enabled", enabled);
        m.put("createdAt", createdAt);
        m.put("provenance", com.oneflight.common.RecordProvenance.view(provenance));
        return m;
    }
}
