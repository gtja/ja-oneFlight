package com.oneflight.service;

import com.oneflight.auth.ScopeService;
import com.oneflight.domain.*;
import com.oneflight.repository.AuditEventRepository;

import org.springframework.stereotype.Service;

@Service
public class AuditService {
    private final ScopeService scope;
    private final AuditEventRepository events;

    public AuditService(ScopeService scope, AuditEventRepository events) {
        this.scope = scope;
        this.events = events;
    }

    public void record(String type, BaseRecord r, String action, String note) {
        record(type, r.id, r.organizationId, r.region, action, note);
    }

    public void record(
            String type, String id, String org, String region, String action, String note) {
        var u = scope.currentUser();
        var e = new AuditEvent();
        e.actorId = u.id();
        e.actorName = u.displayName();
        e.organizationId = org;
        e.region = region;
        e.entityType = type;
        e.entityId = id;
        e.action = action;
        e.note = note;
        events.save(e);
    }
}
