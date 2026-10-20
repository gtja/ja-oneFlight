package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "platform_setting")
public class PlatformSetting {
    @Id
    @Column(length = 80)
    public String id;

    @Column(name = "setting_value", columnDefinition = "TEXT")
    public String value;

    public Instant updatedAt = Instant.now();

    public Map<String, Object> view() {
        return Map.of(
                "id", id, "key", id, "value", value == null ? "" : value, "updatedAt", updatedAt);
    }
}
