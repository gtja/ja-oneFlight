package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.Map;

@Entity
@Table(name = "flight_task")
public class Task extends BaseRecord {
    @Column(columnDefinition = "TEXT")
    public String description;

    @Column(length = 180)
    public String scene;

    @Column(length = 180)
    public String priority;

    public Instant startAt;
    public Instant endAt;

    @Column(length = 180)
    public String deviceId;

    @Column(length = 180)
    public String pilotId;

    @Column(length = 180)
    public String planId;

    @Column(length = 36)
    public String planCreationRequestId;

    @Column(length = 36)
    public String planCreationPlanId;

    @Column(length = 64)
    public String planCreationRequestHash;

    @Column(columnDefinition = "TEXT")
    public String resultSummary;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> m = super.view();
        m.put("description", description);
        m.put("scene", scene);
        m.put("priority", priority);
        m.put("startAt", startAt);
        m.put("endAt", endAt);
        m.put("deviceId", deviceId);
        m.put("pilotId", pilotId);
        m.put("planId", planId);
        m.put("resultSummary", resultSummary);
        return m;
    }
}
