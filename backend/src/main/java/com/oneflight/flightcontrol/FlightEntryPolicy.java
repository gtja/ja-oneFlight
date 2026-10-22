package com.oneflight.flightcontrol;

import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.FlightPlanRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Local business admission only; personal source authorization is checked by the launch service. */
@Service
public class FlightEntryPolicy {
    private static final Set<String> OPEN_STATES = Set.of(
            "DRAFT", "RETURNED", "PENDING_ASSIGNMENT", "PENDING_EXECUTION", "EXECUTING");
    private static final Set<String> EXECUTABLE_STATES = Set.of("PENDING_EXECUTION", "EXECUTING");
    private final TaskRepository tasks;
    private final FlightPlanRepository plans;
    private final ResourceRepository resources;
    private final UserAccountRepository users;
    private final ScopeService scope;
    private final Clock clock;

    @Autowired
    public FlightEntryPolicy(TaskRepository tasks, FlightPlanRepository plans,
            ResourceRepository resources, UserAccountRepository users, ScopeService scope) {
        this(tasks, plans, resources, users, scope, Clock.systemUTC());
    }

    FlightEntryPolicy(TaskRepository tasks, FlightPlanRepository plans,
            ResourceRepository resources, UserAccountRepository users, ScopeService scope, Clock clock) {
        this.tasks = tasks;
        this.plans = plans;
        this.resources = resources;
        this.users = users;
        this.scope = scope;
        this.clock = clock;
    }

    public record Check(String code, String label, boolean passed, String message, String action) {}

    public record EntryCheck(String taskId, boolean eligible, List<Check> checks,
            Map<String, Object> context, Instant checkedAt) {}

    public record Snapshot(String taskId, String planId, String resourceId, String sourceDeviceId,
            long taskVersion, long planVersion, long resourceVersion, String pilotId,
            String pilotPermissionsFingerprint) {}

    @Transactional(readOnly = true)
    public EntryCheck check(CurrentUser user, String taskId) {
        requireCaller(user);
        return evaluate(user, visibleTask(user, taskId), clock.instant()).check();
    }

    @Transactional(readOnly = true)
    public Snapshot requireAllowed(CurrentUser user, String taskId) {
        requireCaller(user);
        Evaluated result = evaluate(user, visibleTask(user, taskId), clock.instant());
        if (!result.check().eligible()) {
            String reason = result.check().checks().stream().filter(check -> !check.passed())
                    .map(Check::message).findFirst().orElse("任务尚未满足飞控入口放行条件");
            throw new ApiException(HttpStatus.FORBIDDEN, "FLIGHT_ENTRY_DENIED", reason);
        }
        return new Snapshot(result.task().id, result.plan().id, result.device().id,
                result.device().sourceDeviceId, result.task().version, result.plan().version,
                result.device().version, result.pilot().id, pilotFingerprint(result.pilot()));
    }

    @Transactional(readOnly = true)
    public PageResult<EntryCheck> candidates(CurrentUser user, String keyword, String deviceId,
            int page, int pageSize) {
        return candidates(user, keyword, deviceId, page, pageSize, false);
    }

    @Transactional(readOnly = true)
    public PageResult<EntryCheck> candidates(CurrentUser user, String keyword, String deviceId,
            int page, int pageSize, boolean includeExpired) {
        requireCaller(user);
        Instant now = clock.instant();
        String search = clean(keyword);
        String deviceFilter = clean(deviceId);
        Set<String> resourceIds = deviceFilter == null ? Set.of() : resources.findAll().stream()
                .filter(resource -> Objects.equals(deviceFilter, resource.sourceDeviceId))
                .filter(resource -> scope.canRead(user, resource))
                .map(resource -> resource.id).collect(java.util.stream.Collectors.toSet());
        List<Task> visible = tasks.findAll().stream()
                .filter(task -> OPEN_STATES.contains(Objects.toString(task.status, "")))
                .filter(task -> scope.canRead(user, task))
                .filter(task -> includeExpired || task.endAt == null || now.isBefore(task.endAt))
                .filter(task -> search == null || contains(task.title, search) || contains(task.id, search))
                .filter(task -> deviceFilter == null || Objects.equals(deviceFilter, task.deviceId)
                        || (task.deviceId != null && resourceIds.contains(task.deviceId)))
                .toList();
        // Rank locally before paging, so a usable task cannot be buried behind old blocked work.
        List<Evaluated> evaluated = visible.stream().map(task -> evaluate(user, task, now))
                .sorted(Comparator.comparingInt((Evaluated item) -> candidateRank(item, now))
                        .thenComparing(item -> item.task().startAt,
                                Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(item -> item.task().id))
                .toList();
        PageResult<Evaluated> selected = PageResult.of(evaluated, page, pageSize);
        return new PageResult<>(selected.items().stream().map(Evaluated::check).toList(),
                selected.total(), selected.page(), selected.pageSize());
    }

    private static int candidateRank(Evaluated item, Instant now) {
        if (item.check().eligible()) return 0;
        if (item.task().endAt != null && !now.isBefore(item.task().endAt)) return 3;
        if (item.task().startAt != null && now.isBefore(item.task().startAt)) return 2;
        return 1;
    }

    private void requireCaller(CurrentUser user) {
        scope.requireRole(user, Role.ADMIN, Role.DISPATCH, Role.PILOT);
    }

    private Task visibleTask(CurrentUser user, String taskId) {
        if (clean(taskId) == null) throw ApiException.invalid("请先选择执行任务");
        Task task = tasks.findById(taskId).orElseThrow(ApiException::missing);
        scope.requireAccess(user, task);
        return task;
    }

    private Evaluated evaluate(CurrentUser user, Task task, Instant now) {
        FlightPlan plan = clean(task.planId) == null ? null : plans.findById(task.planId).orElse(null);
        Resource device = clean(task.deviceId) == null ? null : resources.findById(task.deviceId).orElse(null);
        UserAccount pilot = clean(task.pilotId) == null ? null : users.findById(task.pilotId).orElse(null);
        List<Check> checks = new ArrayList<>();
        add(checks, "PLATFORM_ACCESS", "平台业务权限", true, "当前账号已获得飞控入口业务权限", "PERMISSIONS");
        add(checks, "TASK_STATE", "任务状态", EXECUTABLE_STATES.contains(Objects.toString(task.status, "")),
                "任务须为待执行或执行中", "TASK");
        boolean flightPlan = plan != null && Set.of("DAILY", "LONG_TERM").contains(Objects.toString(plan.kind, ""));
        add(checks, "PLAN_LINK", "关联飞行计划", flightPlan, "任务须关联日常或长期飞行计划", "TASK");
        add(checks, "PLAN_APPROVAL", "计划审批", plan != null && "APPROVED".equals(plan.status),
                "关联飞行计划尚未审批通过", "PLAN");
        add(checks, "PLAN_SCOPE", "计划组织与区域", plan != null
                        && Objects.equals(task.organizationId, plan.organizationId)
                        && Objects.equals(task.region, plan.region)
                        && scope.canRead(user, plan),
                "计划与任务的组织、区域或当前账号权限不一致", "PLAN");
        boolean taskInterval = validInterval(task.startAt, task.endAt);
        boolean planInterval = plan != null && validInterval(plan.startAt, plan.endAt);
        add(checks, "PLAN_TIME", "计划覆盖时段", taskInterval && planInterval
                        && !task.startAt.isBefore(plan.startAt) && !task.endAt.isAfter(plan.endAt),
                "任务须有完整时段，且起止时间必须在已批计划时段内", "TASK");
        boolean withinTask = taskInterval && !now.isBefore(task.startAt) && now.isBefore(task.endAt);
        String timeReason = !taskInterval ? "任务起止时间不完整或无效"
                : now.isBefore(task.startAt) ? "尚未到任务执行时段" : "任务执行时段已结束";
        add(checks, "TASK_TIME", "当前执行时段", withinTask, timeReason, "TASK");
        add(checks, "DEVICE_ASSIGNMENT", "执行设备", device != null && "DEVICE".equals(device.kind)
                        && "ACTIVE".equals(device.status),
                "任务须分配已启用的设备，请先完善设备调度资料及分配", "RESOURCE");
        add(checks, "DEVICE_SCOPE", "设备业务权限", device != null
                        && Objects.equals(task.organizationId, device.organizationId)
                        && scope.canRead(user, device),
                "任务设备的组织或当前账号设备权限已变化，请重新核对分配", "PERMISSIONS");
        add(checks, "SOURCE_DEVICE", "真实来源设备", device != null && clean(device.sourceDeviceId) != null,
                "任务设备尚未绑定真实来源编号", "RESOURCE");
        add(checks, "PILOT_ASSIGNMENT", "执行飞手", pilot != null && pilot.enabled && pilot.role == Role.PILOT,
                "任务须分配已启用且岗位有效的飞手账号", "TASK");
        boolean pilotScope = pilot != null && Objects.equals(task.organizationId, pilot.organizationId)
                && (UserAccount.split(pilot.regions).isEmpty()
                        || (task.region != null && UserAccount.split(pilot.regions).contains(task.region)));
        add(checks, "PILOT_SCOPE", "飞手组织与区域授权", pilotScope,
                "飞手的组织或任务区域授权已变化，请重新配置", "PERMISSIONS");
        Set<String> pilotDevices = pilot == null ? Set.of() : UserAccount.split(pilot.deviceIds);
        add(checks, "PILOT_DEVICE", "飞手设备授权", device != null && pilot != null
                        && (pilotDevices.contains(device.id) || (device.sourceDeviceId != null
                                && pilotDevices.contains(device.sourceDeviceId))),
                "飞手未获执行设备的使用权限", "PERMISSIONS");
        boolean eligible = checks.stream().allMatch(Check::passed);
        EntryCheck check = new EntryCheck(task.id, eligible, List.copyOf(checks),
                context(user, task, plan, device, pilot), now);
        return new Evaluated(check, task, plan, device, pilot);
    }

    private static void add(List<Check> checks, String code, String label, boolean passed,
            String failure, String action) {
        checks.add(new Check(code, label, passed, passed ? "已通过" : failure, action));
    }

    private Map<String, Object> context(CurrentUser user, Task task, FlightPlan plan,
            Resource device, UserAccount pilot) {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("task", subset("id", task.id, "title", task.title, "status", task.status,
                "startAt", task.startAt, "endAt", task.endAt));
        context.put("plan", plan != null && scope.canRead(user, plan)
                ? subset("id", plan.id, "title", plan.title, "status", plan.status, "kind", plan.kind,
                        "startAt", plan.startAt, "endAt", plan.endAt) : Map.of());
        boolean visibleDevice = device != null && scope.canRead(user, device);
        context.put("device", visibleDevice
                ? subset("id", device.id, "title", device.title, "status", device.status,
                        "sourceDeviceId", device.sourceDeviceId) : Map.of());
        context.put("pilot", pilot != null && scope.canAccess(user, pilot.organizationId, task.region)
                ? subset("id", pilot.id, "displayName", pilot.displayName) : Map.of());
        context.put("sourceDeviceId", visibleDevice ? device.sourceDeviceId : null);
        return Collections.unmodifiableMap(context);
    }

    private static Map<String, Object> subset(Object... entries) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int index = 0; index < entries.length; index += 2)
            map.put((String) entries[index], entries[index + 1]);
        return Collections.unmodifiableMap(map);
    }

    private static boolean validInterval(Instant start, Instant end) {
        return start != null && end != null && end.isAfter(start);
    }

    private static String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static boolean contains(String value, String keyword) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(keyword.toLowerCase(Locale.ROOT));
    }

    private static String pilotFingerprint(UserAccount pilot) {
        // Sorted grants keep equivalent permission sets stable without exposing them in the response.
        String permissions = String.join("\n", Objects.toString(pilot.role, ""),
                Boolean.toString(pilot.enabled), Objects.toString(pilot.organizationId, ""),
                String.join(",", UserAccount.split(pilot.regions).stream().sorted().toList()),
                String.join(",", UserAccount.split(pilot.deviceIds).stream().sorted().toList()));
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(permissions.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private record Evaluated(EntryCheck check, Task task, FlightPlan plan, Resource device, UserAccount pilot) {}
}
