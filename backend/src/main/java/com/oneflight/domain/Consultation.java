package com.oneflight.domain;

import jakarta.persistence.*;

import java.util.Map;

@Entity
@Table(name = "consultation")
public class Consultation extends BaseRecord {
    @Column(length = 180)
    public String kind;

    @Column(columnDefinition = "TEXT")
    public String description;

    @Column(columnDefinition = "TEXT")
    public String answer;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> m = super.view();
        m.put("kind", kind);
        m.put("description", description);
        m.put("answer", answer);
        m.put("reply", answer);
        return m;
    }
}
