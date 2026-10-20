package com.oneflight.domain;

import jakarta.persistence.*;

import java.util.Map;

@Entity
@Table(name = "industry_case")
public class IndustryCase extends BaseRecord {
    @Column(length = 180)
    public String scene;

    @Column(columnDefinition = "TEXT")
    public String description;

    @Column(length = 180)
    public String taskId;

    @Column(columnDefinition = "TEXT")
    public String conclusion;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> m = super.view();
        m.put("scene", scene);
        m.put("description", description);
        m.put("taskId", taskId);
        m.put("conclusion", conclusion);
        return m;
    }
}
