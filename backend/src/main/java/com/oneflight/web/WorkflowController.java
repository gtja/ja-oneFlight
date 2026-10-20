package com.oneflight.web;

import com.oneflight.auth.*;
import com.oneflight.common.*;
import com.oneflight.domain.*;
import com.oneflight.service.*;
import com.oneflight.web.Requests.*;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class WorkflowController {
    private final WorkflowService service;
    private final ScopeService scope;
    private final com.oneflight.integration.SourceExtensions extensions;

    public WorkflowController(
            WorkflowService service,
            ScopeService scope,
            com.oneflight.integration.SourceExtensions extensions) {
        this.service = service;
        this.scope = scope;
        this.extensions = extensions;
    }

    private PageResult<Map<String, Object>> page(
            List<? extends BaseRecord> all,
            int page,
            int pageSize,
            String query,
            String status,
            String kind,
            String scene) {
        return PageResult.of(
                all.stream()
                        .filter(service::visible)
                        .filter(x -> status == null || status.isBlank() || status.equals(x.status))
                        .filter(record -> matches(record, query))
                        .filter(
                                x ->
                                        kind == null
                                                || kind.isBlank()
                                                || (x instanceof Resource d && kind.equals(d.kind))
                                                || (x instanceof FlightPlan p
                                                        && kind.equals(p.kind))
                                                || (x instanceof Consultation c
                                                        && kind.equals(c.kind)))
                        .filter(
                                x ->
                                        scene == null
                                                || scene.isBlank()
                                                || (x instanceof Task t && scene.equals(t.scene))
                                                || (x instanceof IndustryCase c
                                                        && scene.equals(c.scene)))
                        .sorted(Comparator.comparing((BaseRecord x) -> x.createdAt).reversed())
                        .map(BaseRecord::view)
                        .toList(),
                page,
                pageSize);
    }

    private boolean matches(BaseRecord record, String query) {
        if (query == null || query.isBlank()) return true;
        List<String> fields = new ArrayList<>();
        fields.add(record.title);
        fields.add(record.id);
        fields.add(record.region);
        if (record instanceof Task task) {
            fields.add(task.scene);
            fields.add(task.description);
            if (task.planId != null) service.plans().findById(task.planId)
                    .filter(service::visible).ifPresent(plan -> {
                        fields.add(plan.title);
                        fields.add(plan.id);
                    });
        }
        if (record instanceof Resource resource) {
            fields.add(resource.model);
            fields.add(resource.sn);
            fields.add(resource.sourceDeviceId);
        }
        if (record instanceof IndustryCase industryCase) {
            fields.add(industryCase.scene);
            fields.add(industryCase.description);
        }
        if (record instanceof FlightPlan plan) fields.add(plan.scope);
        if (record instanceof Consultation consultation) fields.add(consultation.description);
        String keyword = query.trim().toLowerCase(Locale.ROOT);
        return fields.stream()
                .filter(Objects::nonNull)
                .anyMatch(field -> field.toLowerCase(Locale.ROOT).contains(keyword));
    }

    @GetMapping("/tasks")
    public ApiResponse<?> listTask(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String scene,
            @RequestParam(required = false) String planId) {
        if (planId != null && !planId.isBlank()) service.get(service.plans(), planId);
        return ApiResponse.ok(
                page(
                        planId == null || planId.isBlank() ? service.tasks().findAll()
                                : service.tasks().findByPlanId(planId),
                        page,
                        pageSize,
                        query == null ? keyword : query,
                        status,
                        kind,
                        scene));
    }

    @GetMapping("/tasks/{id}")
    public ApiResponse<?> getTask(@PathVariable String id) {
        return ApiResponse.ok(service.get(service.tasks(), id).view());
    }

    @GetMapping("/tasks/{id}/assignment-options")
    public ApiResponse<?> assignmentOptions(
            @PathVariable String id, @RequestParam(required = false) String deviceId) {
        return ApiResponse.ok(service.assignmentOptions(id, deviceId));
    }

    @PostMapping("/tasks")
    public ApiResponse<?> createTask(@Valid @RequestBody TaskInput input) {
        return ApiResponse.ok(service.saveTask(null, input).view());
    }

    @PutMapping("/tasks/{id}")
    public ApiResponse<?> updateTask(@PathVariable String id, @Valid @RequestBody TaskInput input) {
        return ApiResponse.ok(service.saveTask(id, input).view());
    }

    @PostMapping("/tasks/{id}/actions")
    public ApiResponse<?> actionTask(
            @PathVariable String id, @Valid @RequestBody ActionInput input) {
        return ApiResponse.ok(service.taskAction(id, input).view());
    }

    @GetMapping("/tasks/{id}/history")
    public ApiResponse<?> historyTask(
            @PathVariable String id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        service.get(service.tasks(), id);
        return ApiResponse.ok(history("TASK", id, page, pageSize));
    }

    @GetMapping("/plans")
    public ApiResponse<?> listFlightPlan(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String scene) {
        return ApiResponse.ok(
                page(
                        service.plans().findAll(),
                        page,
                        pageSize,
                        query == null ? keyword : query,
                        status,
                        kind,
                        scene));
    }

    @GetMapping("/plans/{id}")
    public ApiResponse<?> getFlightPlan(@PathVariable String id) {
        return ApiResponse.ok(service.get(service.plans(), id).view());
    }

    @GetMapping("/plans/{id}/tasks")
    public ApiResponse<?> listPlanTasks(@PathVariable String id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        return ApiResponse.ok(service.planTasks(id, page, pageSize));
    }

    @PostMapping("/plans/{id}/tasks")
    public ApiResponse<?> createPlanTask(@PathVariable String id,
            @Valid @RequestBody PlanTaskInput input) {
        return ApiResponse.ok(service.createTaskFromPlan(id, input).view());
    }

    @PostMapping("/plans")
    public ApiResponse<?> createFlightPlan(@Valid @RequestBody PlanInput input) {
        return ApiResponse.ok(service.savePlan(null, input).view());
    }

    @PutMapping("/plans/{id}")
    public ApiResponse<?> updateFlightPlan(
            @PathVariable String id, @Valid @RequestBody PlanInput input) {
        return ApiResponse.ok(service.savePlan(id, input).view());
    }

    @PostMapping("/plans/{id}/actions")
    public ApiResponse<?> actionFlightPlan(
            @PathVariable String id, @Valid @RequestBody ActionInput input) {
        return ApiResponse.ok(service.planAction(id, input).view());
    }

    @GetMapping("/plans/{id}/history")
    public ApiResponse<?> historyFlightPlan(
            @PathVariable String id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        service.get(service.plans(), id);
        return ApiResponse.ok(history("PLAN", id, page, pageSize));
    }

    @GetMapping("/resources")
    public ApiResponse<?> listResource(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String scene) {
        return ApiResponse.ok(
                page(
                        service.resources().findAll(),
                        page,
                        pageSize,
                        query == null ? keyword : query,
                        status,
                        kind,
                        scene));
    }

    @GetMapping("/resources/{id}")
    public ApiResponse<?> getResource(@PathVariable String id) {
        return ApiResponse.ok(service.get(service.resources(), id).view());
    }

    @PostMapping("/resources")
    public ApiResponse<?> createResource(@Valid @RequestBody ResourceInput input) {
        return ApiResponse.ok(service.saveResource(null, input).view());
    }

    @PutMapping("/resources/{id}")
    public ApiResponse<?> updateResource(
            @PathVariable String id, @Valid @RequestBody ResourceInput input) {
        return ApiResponse.ok(service.saveResource(id, input).view());
    }

    @GetMapping("/cases")
    public ApiResponse<?> listIndustryCase(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String scene,
            @RequestParam(required = false) String excludeStatus) {
        return ApiResponse.ok(
                page(
                        service.cases().findAll().stream()
                                .filter(
                                        record ->
                                                excludeStatus == null
                                                        || excludeStatus.isBlank()
                                                        || !excludeStatus.equals(record.status))
                                .toList(),
                        page,
                        pageSize,
                        query == null ? keyword : query,
                        status,
                        kind,
                        scene));
    }

    @GetMapping("/cases/{id}")
    public ApiResponse<?> getIndustryCase(@PathVariable String id) {
        return ApiResponse.ok(service.get(service.cases(), id).view());
    }

    @PostMapping("/cases")
    public ApiResponse<?> createIndustryCase(@Valid @RequestBody CaseInput input) {
        return ApiResponse.ok(service.saveCase(null, input).view());
    }

    @PutMapping("/cases/{id}")
    public ApiResponse<?> updateIndustryCase(
            @PathVariable String id, @Valid @RequestBody CaseInput input) {
        return ApiResponse.ok(service.saveCase(id, input).view());
    }

    @PostMapping("/cases/{id}/actions")
    public ApiResponse<?> actionIndustryCase(
            @PathVariable String id, @Valid @RequestBody ActionInput input) {
        return ApiResponse.ok(service.caseAction(id, input).view());
    }

    @GetMapping("/cases/{id}/history")
    public ApiResponse<?> historyIndustryCase(
            @PathVariable String id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        service.get(service.cases(), id);
        return ApiResponse.ok(history("CASE", id, page, pageSize));
    }

    @GetMapping("/consultations")
    public ApiResponse<?> listConsultation(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String scene) {
        return ApiResponse.ok(
                page(
                        service.consultations().findAll(),
                        page,
                        pageSize,
                        query == null ? keyword : query,
                        status,
                        kind,
                        scene));
    }

    @GetMapping("/consultations/{id}")
    public ApiResponse<?> getConsultation(@PathVariable String id) {
        return ApiResponse.ok(service.get(service.consultations(), id).view());
    }

    @PostMapping("/consultations")
    public ApiResponse<?> createConsultation(@Valid @RequestBody ConsultationInput input) {
        return ApiResponse.ok(service.saveConsultation(null, input).view());
    }

    @PutMapping("/consultations/{id}")
    public ApiResponse<?> updateConsultation(
            @PathVariable String id, @Valid @RequestBody ConsultationInput input) {
        return ApiResponse.ok(service.saveConsultation(id, input).view());
    }

    @PostMapping("/consultations/{id}/actions")
    public ApiResponse<?> actionConsultation(
            @PathVariable String id, @Valid @RequestBody ActionInput input) {
        return ApiResponse.ok(service.consultationAction(id, input).view());
    }

    @GetMapping("/consultations/{id}/history")
    public ApiResponse<?> historyConsultation(
            @PathVariable String id,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        service.get(service.consultations(), id);
        return ApiResponse.ok(history("CONSULTATION", id, page, pageSize));
    }

    @GetMapping("/organizations")
    public ApiResponse<?> listOrganization(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String query,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String kind,
            @RequestParam(required = false) String scene) {
        return ApiResponse.ok(
                page(
                        service.organizations().findAll(),
                        page,
                        pageSize,
                        query == null ? keyword : query,
                        status,
                        kind,
                        scene));
    }

    @GetMapping("/organizations/{id}")
    public ApiResponse<?> getOrganization(@PathVariable String id) {
        return ApiResponse.ok(service.get(service.organizations(), id).view());
    }

    @PostMapping("/organizations")
    public ApiResponse<?> createOrganization(@Valid @RequestBody OrganizationInput input) {
        return ApiResponse.ok(service.saveOrganization(null, input).view());
    }

    @PutMapping("/organizations/{id}")
    public ApiResponse<?> updateOrganization(
            @PathVariable String id, @Valid @RequestBody OrganizationInput input) {
        return ApiResponse.ok(service.saveOrganization(id, input).view());
    }

    private PageResult<Map<String, Object>> history(
            String type, String id, int page, int pageSize) {
        return PageResult.of(
                service.events().findAll().stream()
                        .filter(
                                x ->
                                        Objects.equals(x.entityType, type)
                                                && Objects.equals(x.entityId, id))
                        .sorted(Comparator.comparing((AuditEvent x) -> x.createdAt).reversed())
                        .map(AuditEvent::view)
                        .toList(),
                page,
                pageSize);
    }

    @GetMapping("/tasks/{id}/detections")
    public ApiResponse<?> taskDetections(@PathVariable String id) {
        Task task = service.get(service.tasks(), id);
        return ApiResponse.ok(extensions.detections(task.deviceId));
    }

    @GetMapping("/dashboard")
    public ApiResponse<?> dashboard() {
        var tasks = service.tasks().findAll().stream().filter(service::visible).toList();
        var cases = service.cases().findAll().stream().filter(service::visible).toList();
        var resources = service.resources().findAll().stream().filter(service::visible).toList();
        var plans = service.plans().findAll().stream().filter(service::visible).toList();
        Map<String, Long> statuses = statusCounts(tasks);
        Map<String, Long> planStatuses = statusCounts(plans);
        Map<String, Long> caseStatuses = statusCounts(cases);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("taskTotal", tasks.size());
        m.put("executingTasks", statuses.getOrDefault("EXECUTING", 0L));
        m.put(
                "pendingTasks",
                statuses.getOrDefault("PENDING_ASSIGNMENT", 0L)
                        + statuses.getOrDefault("PENDING_EXECUTION", 0L));
        m.put("openCases", cases.stream().filter(c -> !"ARCHIVED".equals(c.status)).count());
        m.put("resourcesCount", resources.size());
        m.put("deviceCount", resources.stream().filter(x -> "DEVICE".equals(x.kind)).count());
        m.put("pendingPlans", planStatuses.getOrDefault("PENDING_REVIEW", 0L));
        m.put("taskCounts", statuses);
        m.put("planCounts", planStatuses);
        m.put("caseCounts", caseStatuses);
        m.put("tasks", tasks.stream().limit(6).map(BaseRecord::view).toList());
        m.put("cases", cases.stream().limit(6).map(BaseRecord::view).toList());
        m.put("controlEnabled", false);
        return ApiResponse.ok(m);
    }

    private Map<String, Long> statusCounts(List<? extends BaseRecord> records) {
        Map<String, Long> counts = new LinkedHashMap<>();
        records.forEach(record -> counts.merge(record.status, 1L, Long::sum));
        return counts;
    }
}
