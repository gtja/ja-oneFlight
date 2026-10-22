package com.oneflight.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.oneflight.common.RecordProvenance;
import com.oneflight.domain.BaseRecord;
import com.oneflight.domain.Consultation;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.IndustryCase;
import com.oneflight.domain.Organization;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.AuditEventRepository;
import com.oneflight.repository.ConsultationRepository;
import com.oneflight.repository.FlightPlanRepository;
import com.oneflight.repository.IndustryCaseRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.repository.PlatformSettingRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import com.oneflight.web.Requests.ActionInput;
import com.oneflight.web.Requests.CaseInput;
import com.oneflight.web.Requests.ConsultationInput;
import com.oneflight.web.Requests.OrganizationInput;
import com.oneflight.web.Requests.PlanInput;
import com.oneflight.web.Requests.PlanTaskInput;
import com.oneflight.web.Requests.ResourceInput;
import com.oneflight.web.Requests.TaskInput;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@Service
@Transactional
public class WorkflowService {
    private final TaskRepository tasks;
    private final FlightPlanRepository plans;
    private final ResourceRepository resources;
    private final IndustryCaseRepository cases;
    private final ConsultationRepository consultations;
    private final OrganizationRepository organizations;
    private final UserAccountRepository users;
    private final AuditEventRepository events;
    private final PlatformSettingRepository settings;
    private final ScopeService scope;
    private final AuditService audit;
    private final TaskAssignmentPolicy assignmentPolicy;
    private final FlightPlanTaskPolicy planTaskPolicy;
    private final TaskAssignmentOptionsQuery assignmentOptionsQuery;
    private final ObjectMapper json = new ObjectMapper();

    public WorkflowService(
            TaskRepository tasks,
            FlightPlanRepository plans,
            ResourceRepository resources,
            IndustryCaseRepository cases,
            ConsultationRepository consultations,
            OrganizationRepository organizations,
            UserAccountRepository users,
            AuditEventRepository events,
            PlatformSettingRepository settings,
            ScopeService scope,
            AuditService audit,
            TaskAssignmentPolicy assignmentPolicy,
            FlightPlanTaskPolicy planTaskPolicy,
            TaskAssignmentOptionsQuery assignmentOptionsQuery) {
        this.tasks = tasks;
        this.plans = plans;
        this.resources = resources;
        this.cases = cases;
        this.consultations = consultations;
        this.organizations = organizations;
        this.users = users;
        this.events = events;
        this.settings = settings;
        this.scope = scope;
        this.audit = audit;
        this.assignmentPolicy = assignmentPolicy;
        this.planTaskPolicy = planTaskPolicy;
        this.assignmentOptionsQuery = assignmentOptionsQuery;
    }

    public TaskRepository tasks() {
        return tasks;
    }

    public FlightPlanRepository plans() {
        return plans;
    }

    public ResourceRepository resources() {
        return resources;
    }

    public IndustryCaseRepository cases() {
        return cases;
    }

    public ConsultationRepository consultations() {
        return consultations;
    }

    public OrganizationRepository organizations() {
        return organizations;
    }

    public UserAccountRepository users() {
        return users;
    }

    public AuditEventRepository events() {
        return events;
    }

    public PlatformSettingRepository settings() {
        return settings;
    }

    public <T extends BaseRecord> T get(
            JpaRepository<T, String> repo, String id) {
        T r = repo.findById(id).orElseThrow(ApiException::missing);
        scope.requireAccess(r);
        if (r instanceof Resource d) scope.requireResource(d);
        return r;
    }

    private void initialize(
            BaseRecord r, String title, String region, String organizationId, String status) {
        var u = scope.currentUser();
        r.title = title;
        r.region = region;
        r.organizationId =
                organizationId == null || organizationId.isBlank()
                        ? u.organizationId()
                        : organizationId;
        r.status = status;
        r.createdBy = u.id();
        if (!organizations.existsById(r.organizationId)) throw ApiException.invalid("组织不存在");
        scope.requireAccess(r);
    }

    private void interval(Instant start, Instant end) {
        if (start == null || end == null || !end.isAfter(start))
            throw ApiException.invalid("结束时间必须晚于开始时间");
    }

    private void expect(BaseRecord r, String... statuses) {
        if (Arrays.stream(statuses).noneMatch(s -> s.equals(r.status)))
            throw new ApiException(HttpStatus.CONFLICT, "INVALID_TRANSITION", "当前状态不能执行此操作");
    }

    private void noteRequired(ActionInput a) {
        if (a.note() == null || a.note().isBlank()) throw ApiException.invalid("请填写办理说明");
    }

    private void linkTask(String id) {
        if (id != null && !id.isBlank()) get(tasks, id);
    }

    private void linkResource(String id) {
        if (id != null && !id.isBlank()) scope.requireResource(get(resources, id));
    }

    private void recordSave(String entityType, BaseRecord record, String id) {
        String action = "UPDATE";
        if (id == null) {
            action = "BUSINESS_INITIALIZATION".equals(RecordProvenance.view(record.provenance).get("origin"))
                    ? "INITIALIZE" : "CREATE";
        }
        audit.record(entityType, record, action, null);
    }

    public Task saveTask(String id, TaskInput in) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT, Role.PILOT);
        Task t = id == null ? new Task() : get(tasks, id);
        if (id == null) {
            scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
            initialize(t, in.title(), in.region(), in.organizationId(), "DRAFT");
        } else {
            expect(t, "DRAFT", "RETURNED", "EXECUTING", "PENDING_ACCEPTANCE");
            if (scope.currentUser().role() == Role.PILOT && !"EXECUTING".equals(t.status))
                throw ApiException.forbidden();
        }
        t.provenance = RecordProvenance.apply(t.provenance, in.provenance(), scope.currentUser());
        interval(in.startAt(), in.endAt());
        if (id != null && !Set.of("DRAFT", "RETURNED").contains(t.status)) {
            scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.PILOT);
            t.resultSummary = in.resultSummary();
            audit.record("TASK", t, "UPDATE_RESULT", null);
            return tasks.save(t);
        }
        t.title = in.title();
        t.region = in.region();
        scope.requireAccess(t);
        t.description = in.description();
        t.scene = in.scene();
        t.priority = in.priority() == null ? "NORMAL" : in.priority();
        t.startAt = in.startAt();
        t.endAt = in.endAt();
        if (in.planId() != null && !in.planId().isBlank())
            planTaskPolicy.requireCompatible(t, planForTask(in.planId()));
        updateTaskPlan(t, in.planId());
        t.resultSummary = in.resultSummary();
        tasks.save(t);
        recordSave("TASK", t, id);
        return t;
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> planTasks(String planId, int page, int pageSize) {
        get(plans, planId);
        return PageResult.of(tasks.findByPlanId(planId).stream().filter(scope::canRead)
                .sorted(Comparator.comparing((Task task) -> task.createdAt).reversed())
                .map(Task::view).toList(), page, pageSize);
    }

    /** Locks the parent plan so retries and concurrent arrangements share one idempotency boundary. */
    public Task createTaskFromPlan(String planId, PlanTaskInput input) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
        FlightPlan plan = plans.findLockedById(planId).orElseThrow(ApiException::missing);
        scope.requireAccess(plan);
        String fingerprint = planTaskFingerprint(input);
        var previous = tasks.findByPlanCreationPlanIdAndPlanCreationRequestId(plan.id, input.requestId());
        if (previous.isPresent()) {
            Task existing = previous.get();
            scope.requireAccess(existing);
            if (!Objects.equals(existing.planCreationRequestHash, fingerprint)
                    || !Objects.equals(existing.createdBy, scope.currentUser().id()))
                throw new ApiException(HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", "该安排请求已用于其他内容，请重新发起");
            return existing;
        }
        if (!planTaskPolicy.isFlightPlan(plan))
            throw ApiException.invalid("仅日常或长期飞行计划可以安排执行任务");
        planTaskPolicy.requireApproved(plan);
        Task task = new Task();
        initialize(task, input.title(), plan.region, plan.organizationId, "PENDING_ASSIGNMENT");
        task.description = input.description();
        task.scene = input.scene();
        task.priority = input.priority() == null ? "NORMAL" : input.priority();
        task.startAt = input.startAt();
        task.endAt = input.endAt();
        task.planId = plan.id;
        task.planCreationPlanId = plan.id;
        task.planCreationRequestId = input.requestId();
        task.planCreationRequestHash = fingerprint;
        task.provenance = RecordProvenance.apply(null, null, scope.currentUser());
        planTaskPolicy.requireCompatible(task, plan);
        tasks.saveAndFlush(task);
        audit.record("TASK", task, "CREATE_FROM_PLAN", "依据已批计划“" + plan.title + "”安排执行任务");
        return task;
    }

    private String planTaskFingerprint(PlanTaskInput input) {
        try {
            List<Object> values = Arrays.asList(input.title(), input.description(), input.scene(),
                    input.priority() == null ? "NORMAL" : input.priority(),
                    input.startAt().toString(), input.endAt().toString());
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(json.writeValueAsBytes(values)));
        } catch (NoSuchAlgorithmException | JsonProcessingException e) {
            throw new IllegalStateException("Unable to fingerprint task arrangement", e);
        }
    }

    private FlightPlan requireTaskPlan(Task task, boolean approved) {
        if (task.planId == null || task.planId.isBlank()) {
            if (approved && !"资料核对".equals(task.scene))
                throw new ApiException(HttpStatus.CONFLICT, "PLAN_APPROVAL_REQUIRED", "请先关联已审批通过的飞行计划");
            return null;
        }
        FlightPlan plan = planForTask(task.planId);
        planTaskPolicy.requireCompatible(task, plan);
        if (approved) planTaskPolicy.requireApproved(plan);
        return plan;
    }

    private FlightPlan planForTask(String planId) {
        FlightPlan plan = plans.findLockedById(planId).orElseThrow(ApiException::missing);
        scope.requireAccess(plan);
        return plan;
    }

    private void updateTaskPlan(Task task, String planId) {
        String normalized = planId == null || planId.isBlank() ? null : planId;
        if (!Objects.equals(task.planId, normalized) && task.planId != null)
            plans.findById(task.planId).filter(plan -> Objects.equals(plan.taskId, task.id))
                    .ifPresent(plan -> {
                        plan.taskId = null;
                        plans.save(plan);
                    });
        task.planId = normalized;
    }

    private List<Task> assignmentOverlaps(Task task) {
        return assignmentPolicy.hasValidInterval(task)
                ? tasks.findAssignmentOverlaps(task.id, task.startAt, task.endAt)
                : List.of();
    }

    @Transactional(readOnly = true)
    public TaskAssignmentOptions assignmentOptions(String taskId, String deviceId) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        Task task = get(tasks, taskId);
        Resource selectedDevice = null;
        if (deviceId != null && !deviceId.isBlank()) {
            selectedDevice = get(resources, deviceId);
            if (!"DEVICE".equals(selectedDevice.kind))
                throw ApiException.invalid("所选资源不是执行设备");
        }
        List<Task> overlaps = assignmentOverlaps(task);
        return assignmentOptionsQuery.forTask(task, selectedDevice, overlaps);
    }

    public Task taskAction(String id, ActionInput a) {
        Task t = get(tasks, id);
        switch (a.action()) {
            case "SUBMIT" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
                expect(t, "DRAFT", "RETURNED");
                requireTaskPlan(t, false);
                t.status = "PENDING_ASSIGNMENT";
            }
            case "LINK_PLAN" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(t, "PENDING_ASSIGNMENT", "PENDING_EXECUTION");
                if (a.planId() == null || a.planId().isBlank())
                    throw ApiException.invalid("请选择关联飞行计划");
                FlightPlan linkedPlan = planForTask(a.planId());
                planTaskPolicy.requireCompatible(t, linkedPlan);
                updateTaskPlan(t, linkedPlan.id);
            }
            case "ASSIGN" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(t, "PENDING_ASSIGNMENT");
                if (a.deviceId() == null || a.deviceId().isBlank()
                        || a.pilotId() == null || a.pilotId().isBlank())
                    throw ApiException.invalid("请选择设备和飞手");
                Resource d =
                        resources.findLockedById(a.deviceId()).orElseThrow(ApiException::missing);
                scope.requireResource(d);
                UserAccount p =
                        users.findLockedById(a.pilotId()).orElseThrow(ApiException::missing);
                assignmentPolicy.requireAssignable(t, d, p, assignmentOverlaps(t));
                t.deviceId = d.id;
                t.pilotId = p.id;
                if (a.planId() != null) {
                    if (a.planId().isBlank()) updateTaskPlan(t, null);
                    else {
                        FlightPlan assignedPlan = planForTask(a.planId());
                        planTaskPolicy.requireCompatible(t, assignedPlan);
                        updateTaskPlan(t, assignedPlan.id);
                    }
                }
                requireTaskPlan(t, false);
                t.status = "PENDING_EXECUTION";
            }
            case "START" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.PILOT);
                expect(t, "PENDING_EXECUTION");
                requireTaskPlan(t, true);
                t.status = "EXECUTING";
            }
            case "FINISH" -> {
                if (a.resultSummary() != null) t.resultSummary = a.resultSummary();
                scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.PILOT);
                expect(t, "EXECUTING");
                if (t.resultSummary == null || t.resultSummary.isBlank())
                    throw ApiException.invalid("请先填写执行成果");
                t.status = "PENDING_ACCEPTANCE";
            }
            case "ACCEPT" -> {
                scope.requireRole(Role.ADMIN, Role.DEPARTMENT);
                expect(t, "PENDING_ACCEPTANCE");
                t.status = "COMPLETED";
            }
            case "RETURN" -> {
                noteRequired(a);
                if ("PENDING_ASSIGNMENT".equals(t.status)) {
                    scope.requireRole(Role.ADMIN, Role.DISPATCH);
                    t.status = "RETURNED";
                } else {
                    scope.requireRole(Role.ADMIN, Role.DEPARTMENT);
                    expect(t, "PENDING_ACCEPTANCE");
                    t.status = "EXECUTING";
                }
            }
            case "CANCEL" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
                expect(t, "DRAFT", "RETURNED", "PENDING_ASSIGNMENT", "PENDING_EXECUTION");
                noteRequired(a);
                t.status = "CANCELLED";
            }
            default -> throw ApiException.invalid("未知任务操作");
        }
        audit.record("TASK", t, a.action(), a.note());
        return tasks.save(t);
    }

    private void requirePlanWrite(FlightPlan plan) {
        var user = scope.currentUser();
        if (user.role() == Role.PILOT && !Objects.equals(plan.createdBy, user.id()))
            throw ApiException.forbidden();
    }

    public FlightPlan savePlan(String id, PlanInput in) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT, Role.PILOT);
        FlightPlan p = id == null ? new FlightPlan()
                : plans.findLockedById(id).orElseThrow(ApiException::missing);
        if (id == null) initialize(p, in.title(), in.region(), in.organizationId(), "DRAFT");
        else {
            scope.requireAccess(p);
            requirePlanWrite(p);
            expect(p, "DRAFT", "RETURNED");
        }
        p.provenance = RecordProvenance.apply(p.provenance, in.provenance(), scope.currentUser());
        interval(in.startAt(), in.endAt());
        if (!Set.of("DAILY", "LONG_TERM", "DEVICE_ADMISSION", "PERSON_ADMISSION", "PILOT_ADMISSION")
                .contains(in.kind())) throw ApiException.invalid("计划类型不正确");
        linkResource(in.resourceId());
        p.title = in.title();
        p.region = in.region();
        scope.requireAccess(p);
        p.kind = in.kind();
        p.startAt = in.startAt();
        p.endAt = in.endAt();
        p.height = in.height();
        p.scope = in.scope();
        p.resourceId = in.resourceId();
        p.taskId = in.taskId();
        p.materialName = in.materialName();
        p.materialNumber = in.materialNumber();
        p.validFrom = in.validFrom();
        p.validUntil = in.validUntil();
        if (p.validFrom != null && p.validUntil != null && p.validUntil.isBefore(p.validFrom))
            throw ApiException.invalid("材料有效期不正确");
        for (Task linkedTask : tasks.findByPlanId(p.id))
            planTaskPolicy.requireCompatible(linkedTask, p);
        if (p.taskId != null && !p.taskId.isBlank()) {
            Task primaryTask = get(tasks, p.taskId);
            planTaskPolicy.requireCompatible(primaryTask, p);
            if (!Objects.equals(primaryTask.planId, p.id)) {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(primaryTask, "DRAFT", "RETURNED", "PENDING_ASSIGNMENT", "PENDING_EXECUTION");
                if (primaryTask.planId != null && !primaryTask.planId.isBlank())
                    throw ApiException.invalid("该任务已关联其他计划，请在任务调度中明确更换关联计划");
                primaryTask.planId = p.id;
                tasks.save(primaryTask);
                audit.record("TASK", primaryTask, "LINK_PLAN", "通过飞行计划关联任务");
            }
        }
        plans.save(p);
        recordSave("PLAN", p, id);
        return p;
    }

    public FlightPlan planAction(String id, ActionInput a) {
        FlightPlan p = plans.findLockedById(id).orElseThrow(ApiException::missing);
        scope.requireAccess(p);
        requirePlanWrite(p);
        switch (a.action()) {
            case "SUBMIT" -> {
                expect(p, "DRAFT", "RETURNED");
                for (Task linkedTask : tasks.findByPlanId(p.id))
                    planTaskPolicy.requireCompatible(linkedTask, p);
                p.status = "PENDING_REVIEW";
            }
            case "APPROVE" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(p, "PENDING_REVIEW");
                for (Task linkedTask : tasks.findByPlanId(p.id))
                    planTaskPolicy.requireCompatible(linkedTask, p);
                p.status = "APPROVED";
            }
            case "RETURN" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(p, "PENDING_REVIEW");
                noteRequired(a);
                p.status = "RETURNED";
            }
            case "CANCEL" -> {
                expect(p, "DRAFT", "RETURNED", "PENDING_REVIEW");
                noteRequired(a);
                p.status = "CANCELLED";
            }
            case "REGISTER_RECEIPT" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(p, "APPROVED");
                if (a.receiptNumber() == null || a.receiptNumber().isBlank())
                    throw ApiException.invalid("请填写回执编号");
                p.receiptNumber = a.receiptNumber();
                p.receiptBasis = a.receiptBasis();
            }
            default -> throw ApiException.invalid("未知计划操作");
        }
        audit.record("PLAN", p, a.action(), a.note());
        return plans.save(p);
    }

    public Resource saveResource(String id, ResourceInput in) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        Resource r = id == null ? new Resource() : get(resources, id);
        if (!Set.of("DEVICE", "PERSON", "ROUTE", "AIRSPACE", "MAINTENANCE", "ALGORITHM_DATASET", "ALGORITHM_TRAINING").contains(in.kind()))
            throw ApiException.invalid("资源类型不正确");
        if (id == null) initialize(r, in.title(), in.region(), in.organizationId(), "ACTIVE");
        else {
            String organizationId = in.organizationId() == null || in.organizationId().isBlank()
                    ? r.organizationId : in.organizationId().trim();
            if (!Objects.equals(organizationId, r.organizationId)) {
                Organization destination = organizations.findById(organizationId)
                        .orElseThrow(() -> ApiException.invalid("组织不存在"));
                if (!"ACTIVE".equals(destination.status))
                    throw ApiException.invalid("所属组织已停用，请选择已启用的组织");
            }
            // Check both scopes before changing a managed entity; its old scope was checked by get.
            Resource destinationScope = new Resource();
            destinationScope.id = r.id;
            destinationScope.kind = r.kind;
            destinationScope.sourceDeviceId = r.sourceDeviceId;
            destinationScope.organizationId = organizationId;
            destinationScope.region = in.region();
            scope.requireAccess(destinationScope);
            r.organizationId = organizationId;
        }
        r.title = in.title();
        r.region = in.region();
        scope.requireAccess(r);
        r.kind = in.kind();
        r.status = in.status() == null ? "ACTIVE" : in.status();
        if (!Set.of("ACTIVE", "INACTIVE", "MAINTENANCE", "PENDING_CONFIRMATION", "PENDING_LABELING", "PENDING_CONFIGURATION").contains(r.status))
            throw ApiException.invalid("资源状态不正确");
        if ("ALGORITHM_TRAINING".equals(r.kind) && !"PENDING_CONFIGURATION".equals(r.status))
            throw ApiException.invalid("训练服务未接通，只能登记待接入事项");
        if ("ALGORITHM_DATASET".equals(r.kind) && !"PENDING_LABELING".equals(r.status))
            throw ApiException.invalid("样本尚未标注核验，只能登记待标注集合");
        if (in.metadata() != null && in.metadata().get("provenance") instanceof Map<?, ?> raw) {
            Map<String, Object> input = new LinkedHashMap<>();
            raw.forEach((key, val) -> input.put(String.valueOf(key), val));
            r.provenance = RecordProvenance.apply(r.provenance, input, scope.currentUser());
        }
        r.model = in.model();
        r.sourceDeviceId =
                in.sourceDeviceId() == null || in.sourceDeviceId().isBlank()
                        ? null
                        : in.sourceDeviceId().trim();
        if (r.sourceDeviceId != null
                && resources.findAll().stream()
                        .anyMatch(
                                existing ->
                                        !existing.id.equals(r.id)
                                                && Objects.equals(existing.kind, r.kind)
                                                && Objects.equals(
                                                        existing.sourceDeviceId, r.sourceDeviceId)))
            throw new ApiException(
                    HttpStatus.CONFLICT, "DUPLICATE_SOURCE_DEVICE", "该来源设备已登记，请使用已有资源");
        r.productKey = in.productKey();
        r.sn = in.sn();
        r.longitude = in.longitude();
        r.latitude = in.latitude();
        try {
            r.metadata = json.writeValueAsString(in.metadata() == null ? Map.of() : in.metadata());
        } catch (Exception e) {
            throw ApiException.invalid("扩展字段格式不正确");
        }
        resources.save(r);
        recordSave("RESOURCE", r, id);
        return r;
    }

    public IndustryCase saveCase(String id, CaseInput in) {
        IndustryCase c = id == null ? new IndustryCase() : get(cases, id);
        if (id == null)
            initialize(c, in.title(), in.region(), in.organizationId(), "PENDING_REVIEW");
        else expect(c, "PENDING_REVIEW", "PENDING_DISPOSAL");
        linkTask(in.taskId());
        c.title = in.title();
        c.region = in.region();
        scope.requireAccess(c);
        c.provenance = RecordProvenance.apply(c.provenance, in.provenance(), scope.currentUser());
        c.scene = in.scene();
        c.description = in.description();
        c.taskId = in.taskId();
        c.conclusion = in.conclusion();
        cases.save(c);
        recordSave("CASE", c, id);
        return c;
    }

    public IndustryCase caseAction(String id, ActionInput a) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
        IndustryCase c = get(cases, id);
        switch (a.action()) {
            case "VERIFY" -> {
                expect(c, "PENDING_REVIEW");
                c.status = "PENDING_DISPOSAL";
                if (a.conclusion() != null) c.conclusion = a.conclusion();
            }
            case "DISMISS" -> {
                expect(c, "PENDING_REVIEW");
                String conclusion =
                        a.conclusion() == null || a.conclusion().isBlank()
                                ? a.note()
                                : a.conclusion();
                if (conclusion == null || conclusion.isBlank())
                    throw ApiException.invalid("请填写处理结论");
                c.conclusion = conclusion;
                c.status = "ARCHIVED";
            }
            case "RESOLVE" -> {
                expect(c, "PENDING_DISPOSAL");
                String conclusion =
                        a.conclusion() == null || a.conclusion().isBlank()
                                ? a.note()
                                : a.conclusion();
                if (conclusion == null || conclusion.isBlank())
                    throw ApiException.invalid("请填写处理结论");
                c.conclusion = conclusion;
                c.status = "ARCHIVED";
            }
            case "ARCHIVE" -> {
                expect(c, "RESOLVED");
                c.status = "ARCHIVED";
            }
            default -> throw ApiException.invalid("未知线索操作");
        }
        String auditNote = a.note() == null || a.note().isBlank() ? c.conclusion : a.note();
        if (auditNote != null && auditNote.length() > 2000)
            auditNote = auditNote.substring(0, 2000);
        audit.record("CASE", c, a.action(), auditNote);
        return cases.save(c);
    }

    public Consultation saveConsultation(String id, ConsultationInput in) {
        Consultation c = id == null ? new Consultation() : get(consultations, id);
        if (id == null) initialize(c, in.title(), in.region(), in.organizationId(), "OPEN");
        else expect(c, "OPEN");
        c.title = in.title();
        c.region = in.region();
        scope.requireAccess(c);
        c.provenance = RecordProvenance.apply(c.provenance, in.provenance(), scope.currentUser());
        c.kind = in.kind() == null ? "CONSULTATION" : in.kind();
        c.description = in.description();
        consultations.save(c);
        recordSave("CONSULTATION", c, id);
        return c;
    }

    public Consultation consultationAction(String id, ActionInput a) {
        Consultation c = get(consultations, id);
        switch (a.action()) {
            case "REPLY" -> {
                scope.requireRole(Role.ADMIN, Role.DISPATCH);
                expect(c, "OPEN");
                String reply = a.reply() == null || a.reply().isBlank() ? a.note() : a.reply();
                if (reply == null || reply.isBlank()) throw ApiException.invalid("请填写答复");
                c.answer = reply;
                c.status = "ANSWERED";
            }
            case "COMPLETE" -> {
                expect(c, "ANSWERED");
                c.status = "COMPLETED";
            }
            default -> throw ApiException.invalid("未知咨询操作");
        }
        audit.record("CONSULTATION", c, a.action(), a.note());
        return consultations.save(c);
    }

    public Organization saveOrganization(String id, OrganizationInput in) {
        scope.requireRole(Role.ADMIN);
        Organization o = id == null ? new Organization() : get(organizations, id);
        o.title = in.title();
        o.region = in.region();
        o.organizationId = o.id;
        o.status = "ACTIVE";
        o.createdBy = scope.currentUser().id();
        if (in.parentId() != null && !in.parentId().isBlank()) {
            if (in.parentId().equals(o.id)) throw ApiException.invalid("组织不能作为自己的上级");
            organizations.findById(in.parentId()).orElseThrow(ApiException::missing);
        }
        o.parentId = in.parentId();
        o.contact = in.contact();
        organizations.save(o);
        audit.record("ORGANIZATION", o, id == null ? "CREATE" : "UPDATE", null);
        return o;
    }

    public boolean visible(BaseRecord record) {
        return scope.canRead(record);
    }
}
