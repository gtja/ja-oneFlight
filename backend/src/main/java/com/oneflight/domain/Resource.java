package com.oneflight.domain;

import jakarta.persistence.*;

import java.util.Map;

@Entity
@Table(name = "platform_resource")
public class Resource extends BaseRecord {
    @Column(length = 180)
    public String kind;

    @Column(length = 180)
    public String model;

    @Column(length = 180)
    public String sourceDeviceId;

    @Column(length = 180)
    public String productKey;

    @Column(length = 180)
    public String sn;

    public Double longitude;
    public Double latitude;

    @Column(columnDefinition = "TEXT")
    public String metadata;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> m = super.view();
        m.put("kind", kind);
        m.put("model", model);
        m.put("sourceDeviceId", sourceDeviceId);
        m.put("productKey", productKey);
        m.put("sn", sn);
        m.put("longitude", longitude);
        m.put("latitude", latitude);
        try {
            m.put(
                    "metadata",
                    metadata == null
                            ? java.util.Map.of()
                            : new com.fasterxml.jackson.databind.ObjectMapper()
                                    .readValue(metadata, java.util.Map.class));
        } catch (Exception e) {
            m.put("metadata", java.util.Map.of());
        }
        m.put("name", title);
        return m;
    }
}
