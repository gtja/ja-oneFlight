package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "flight_plan")
public class FlightPlan extends BaseRecord {
    @Column(length = 180)
    public String kind;

    public Instant startAt;
    public Instant endAt;
    public Double height;

    @Column(columnDefinition = "TEXT")
    public String scope;

    @Column(length = 180)
    public String resourceId;

    @Column(length = 180)
    public String taskId;

    @Column(length = 180)
    public String receiptNumber;

    @Column(columnDefinition = "TEXT")
    public String receiptBasis;

    @Column(length = 180)
    public String materialName;

    @Column(length = 180)
    public String materialNumber;

    public java.time.LocalDate validFrom;
    public java.time.LocalDate validUntil;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> m = super.view();
        m.put("kind", kind);
        m.put("startAt", startAt);
        m.put("endAt", endAt);
        m.put("height", height);
        m.put("scope", scope);
        m.put("resourceId", resourceId);
        m.put("taskId", taskId);
        m.put("receiptNumber", receiptNumber);
        m.put("receiptBasis", receiptBasis);
        m.put("materialName", materialName);
        m.put("materialNumber", materialNumber);
        m.put("validFrom", validFrom);
        m.put("validUntil", validUntil);
        return m;
    }
}
