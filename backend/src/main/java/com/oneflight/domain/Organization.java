package com.oneflight.domain;

import jakarta.persistence.*;

import java.util.Map;

@Entity
@Table(name = "organization")
public class Organization extends BaseRecord {
    @Column(length = 180)
    public String parentId;

    @Column(length = 180)
    public String contact;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> m = super.view();
        m.put("parentId", parentId);
        m.put("contact", contact);
        return m;
    }
}
