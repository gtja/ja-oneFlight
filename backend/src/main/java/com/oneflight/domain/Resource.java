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

    @Column(columnDefinition = "MEDIUMTEXT")
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
                            : metadataJson()
                                    .readValue(metadata, java.util.Map.class));
        } catch (Exception e) {
            m.put("metadata", java.util.Map.of());
        }
        m.put("name", title);
        return m;
    }

    private com.fasterxml.jackson.databind.ObjectMapper metadataJson() {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        if ("AIRSPACE".equals(kind))
            json.enable(com.fasterxml.jackson.databind.DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
        return json;
    }
}
