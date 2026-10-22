package com.oneflight.flightcontrol;

import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.ScopeService;
import com.oneflight.domain.AuditEvent;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.TaskRepository;
import org.springframework.stereotype.Service;

/** Child-origin checks have an explicit verified principal, never a thread impersonation. */
@Service
public class FlightEntryAudit {
    private final AuditEventRepository events;
    private final TaskRepository tasks;
    private final ScopeService scope;

    public FlightEntryAudit(AuditEventRepository events, TaskRepository tasks, ScopeService scope) {
        this.events = events; this.tasks = tasks; this.scope = scope;
    }

    public void record(CurrentUser user, String taskId, String action, String reason) {
        var event = new AuditEvent();
        event.actorId = user.id();
        event.actorName = user.displayName();
        event.organizationId = user.organizationId();
        event.entityType = "TASK";
        event.entityId = taskId;
        event.action = action;
        event.note = reason != null && reason.matches("[A-Z0-9_]{1,64}") ? reason : "ENTRY_CHECK";
        if (taskId != null) tasks.findById(taskId).filter(task -> scope.canRead(user, task)).ifPresent(task -> {
            event.organizationId = task.organizationId;
            event.region = task.region;
        });
        events.save(event);
    }
}
