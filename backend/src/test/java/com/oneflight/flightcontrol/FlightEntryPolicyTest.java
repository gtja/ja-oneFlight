package com.oneflight.flightcontrol;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.oneflight.auth.CurrentUser;
import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;
import com.oneflight.repository.FlightPlanRepository;
import com.oneflight.repository.ResourceRepository;
import com.oneflight.repository.TaskRepository;
import com.oneflight.repository.UserAccountRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.context.SecurityContextHolder;

class FlightEntryPolicyTest {
    private final TaskRepository tasks = mock(TaskRepository.class);
    private final FlightPlanRepository plans = mock(FlightPlanRepository.class);
    private final ResourceRepository resources = mock(ResourceRepository.class);
    private final UserAccountRepository users = mock(UserAccountRepository.class);
    private final MutableClock clock = new MutableClock();
    private final ScopeService scope = new ScopeService(users, resources, tasks);
    private final FlightEntryPolicy policy = new FlightEntryPolicy(tasks, plans, resources, users, scope, clock);
    private final List<Task> taskRows = new ArrayList<>();
    private Task task;
    private FlightPlan plan;
    private Resource device;
    private UserAccount pilot;

    @BeforeEach
    void fixture() {
        SecurityContextHolder.clearContext();
        plan = new FlightPlan();
        plan.id = "plan";
        plan.title = "已批飞行计划";
        plan.kind = "DAILY";
        plan.status = "APPROVED";
        plan.organizationId = "org";
        plan.region = "杭州";
        plan.startAt = clock.instant().minusSeconds(3600);
        plan.endAt = clock.instant().plusSeconds(3600);
        plan.version = 2;
        device = new Resource();
        device.id = "device";
        device.title = "设备";
        device.kind = "DEVICE";
        device.status = "ACTIVE";
        device.organizationId = "org";
        device.region = "杭州";
        device.sourceDeviceId = "source-device";
        device.version = 3;
        pilot = new UserAccount();
        pilot.id = "pilot";
        pilot.username = "internal-projection";
        pilot.displayName = "执行飞手";
        pilot.passwordHash = "secret-password-hash";
        pilot.enabled = true;
        pilot.role = Role.PILOT;
        pilot.organizationId = "org";
        pilot.regions = "杭州";
        pilot.deviceIds = "source-device";
        task = new Task();
        task.id = "task";
        task.title = "巡检任务";
        task.organizationId = "org";
        task.region = "杭州";
        task.status = "PENDING_EXECUTION";
        task.planId = plan.id;
        task.deviceId = device.id;
        task.pilotId = pilot.id;
        task.startAt = clock.instant().minusSeconds(60);
        task.endAt = clock.instant().plusSeconds(60);
        task.version = 1;
        taskRows.add(task);
        when(tasks.findAll()).thenAnswer(call -> List.copyOf(taskRows));
        when(tasks.findById(anyString())).thenAnswer(call -> taskRows.stream()
                .filter(row -> row.id.equals(call.getArgument(0))).findFirst());
        when(tasks.findByPlanIdAndPilotId(anyString(), anyString())).thenAnswer(call -> taskRows.stream()
                .filter(row -> java.util.Objects.equals(row.planId, call.getArgument(0))
                        && java.util.Objects.equals(row.pilotId, call.getArgument(1))).toList());
        when(plans.findById(plan.id)).thenAnswer(call -> Optional.of(plan));
        when(resources.findById(device.id)).thenAnswer(call -> Optional.of(device));
        when(resources.findAll()).thenAnswer(call -> List.of(device));
        when(users.findById(pilot.id)).thenAnswer(call -> Optional.of(pilot));
    }

    private CurrentUser admin() {
        return new CurrentUser("admin", "admin", "管理员", Role.ADMIN, "other-org", Set.of(), Set.of());
    }

    private CurrentUser dispatch(Set<String> regions, Set<String> devices) {
        return new CurrentUser("dispatch", "dispatch", "调度", Role.DISPATCH, "org", regions, devices);
    }

    @Test
    void validLocalApprovalAllowsWithoutAnyThreadSecurityContextOrOnlineObservation() {
        FlightEntryPolicy.EntryCheck check = policy.check(admin(), task.id);
        assertThat(check.eligible()).isTrue();
        assertThat(check.checks()).allMatch(FlightEntryPolicy.Check::passed);
        assertThat(check.checkedAt()).isEqualTo(clock.instant());
        assertThat(check.context().get("sourceDeviceId")).isEqualTo("source-device");
        assertThat(check.toString()).doesNotContain("passwordHash", "secret-password-hash", "internal-projection", "deviceIds");
        FlightEntryPolicy.Snapshot snapshot = policy.requireAllowed(admin(), task.id);
        assertThat(snapshot.taskId()).isEqualTo(task.id);
        assertThat(snapshot.planId()).isEqualTo(plan.id);
        assertThat(snapshot.resourceId()).isEqualTo(device.id);
        assertThat(snapshot.pilotId()).isEqualTo(pilot.id);
        assertThat(snapshot.taskVersion()).isEqualTo(1);
        assertThat(snapshot.planVersion()).isEqualTo(2);
        assertThat(snapshot.resourceVersion()).isEqualTo(3);
        assertThat(snapshot.pilotPermissionsFingerprint()).hasSize(64);
    }

    @ParameterizedTest
    @ValueSource(strings = {"DAILY", "LONG_TERM"})
    void bothApprovedBusinessPlanKindsCanBeUsed(String kind) {
        plan.kind = kind;
        assertThat(policy.check(pilot.current(), task.id).eligible()).isTrue();
    }

    @ParameterizedTest
    @CsvSource({"START,true", "BEFORE_START,false", "END,false", "AFTER_END,false"})
    void serverTimeIncludesStartAndExcludesEndEvenForAdministrator(String boundary, boolean eligible) {
        clock.now = switch (boundary) {
            case "START" -> task.startAt;
            case "BEFORE_START" -> task.startAt.minusNanos(1);
            case "END" -> task.endAt;
            default -> task.endAt.plusNanos(1);
        };
        assertThat(policy.check(admin(), task.id).eligible()).isEqualTo(eligible);
        if (!eligible) assertThatThrownBy(() -> policy.requireAllowed(admin(), task.id))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.getCode()).isEqualTo("FLIGHT_ENTRY_DENIED"));
    }

    @ParameterizedTest
    @CsvSource({
        "DRAFT,TASK_STATE", "RETURNED,TASK_STATE", "PENDING_ASSIGNMENT,TASK_STATE",
        "COMPLETED,TASK_STATE", "CANCELLED,TASK_STATE", "NO_PLAN,PLAN_LINK",
        "PLAN_DRAFT,PLAN_APPROVAL", "ADMISSION,PLAN_LINK", "PLAN_ORG,PLAN_SCOPE",
        "PLAN_REGION,PLAN_SCOPE", "PLAN_START,PLAN_TIME", "PLAN_END,PLAN_TIME",
        "TASK_INVALID_TIME,PLAN_TIME", "NO_DEVICE,DEVICE_ASSIGNMENT",
        "DEVICE_DISABLED,DEVICE_ASSIGNMENT", "DEVICE_TYPE,DEVICE_ASSIGNMENT",
        "DEVICE_ORG,DEVICE_SCOPE", "NO_SOURCE,SOURCE_DEVICE", "NO_PILOT,PILOT_ASSIGNMENT",
        "PILOT_DISABLED,PILOT_ASSIGNMENT", "PILOT_ROLE,PILOT_ASSIGNMENT",
        "PILOT_ORG,PILOT_SCOPE", "PILOT_REGION,PILOT_SCOPE", "PILOT_DEVICE,PILOT_DEVICE"
    })
    void currentBusinessConditionsAreCheckedAgainWithoutAdministratorBypass(String mutation, String code) {
        switch (mutation) {
            case "DRAFT", "RETURNED", "PENDING_ASSIGNMENT", "COMPLETED", "CANCELLED" -> task.status = mutation;
            case "NO_PLAN" -> task.planId = null;
            case "PLAN_DRAFT" -> plan.status = "DRAFT";
            case "ADMISSION" -> plan.kind = "DEVICE_ADMISSION";
            case "PLAN_ORG" -> plan.organizationId = "foreign";
            case "PLAN_REGION" -> plan.region = "宁波";
            case "PLAN_START" -> plan.startAt = task.startAt.plusSeconds(1);
            case "PLAN_END" -> plan.endAt = task.endAt.minusSeconds(1);
            case "TASK_INVALID_TIME" -> task.endAt = task.startAt;
            case "NO_DEVICE" -> task.deviceId = null;
            case "DEVICE_DISABLED" -> device.status = "DISABLED";
            case "DEVICE_TYPE" -> device.kind = "ROUTE";
            case "DEVICE_ORG" -> device.organizationId = "foreign";
            case "NO_SOURCE" -> device.sourceDeviceId = null;
            case "NO_PILOT" -> task.pilotId = null;
            case "PILOT_DISABLED" -> pilot.enabled = false;
            case "PILOT_ROLE" -> pilot.role = Role.ADMIN;
            case "PILOT_ORG" -> pilot.organizationId = "foreign";
            case "PILOT_REGION" -> pilot.regions = "宁波";
            case "PILOT_DEVICE" -> pilot.deviceIds = "another-device";
            default -> throw new IllegalArgumentException(mutation);
        }
        FlightEntryPolicy.EntryCheck result = policy.check(admin(), task.id);
        assertThat(result.eligible()).isFalse();
        assertThat(result.checks()).anyMatch(check -> code.equals(check.code()) && !check.passed());
    }

    @Test
    void pendingBusinessAuthorizationAndDepartmentRoleAreRejected() {
        CurrentUser pending = new CurrentUser("pending", "pending", "待授权", Role.ADMIN,
                "org", Set.of(), Set.of(), Set.of(), false);
        assertThatThrownBy(() -> policy.check(pending, task.id)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.getCode()).isEqualTo("BUSINESS_ACCESS_PENDING"));
        CurrentUser department = new CurrentUser("department", "department", "业务", Role.DEPARTMENT,
                "org", Set.of(), Set.of());
        assertThatThrownBy(() -> policy.candidates(department, null, null, 1, 20))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    @Test
    void otherPilotsTaskAndForeignOrganizationsCannotBeInspectedOrListed() {
        CurrentUser otherPilot = new CurrentUser("other", "other", "其他飞手", Role.PILOT,
                "org", Set.of(), Set.of(device.id));
        assertThatThrownBy(() -> policy.check(otherPilot, task.id)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.getStatus()).isEqualTo(HttpStatus.FORBIDDEN));
        assertThat(policy.candidates(otherPilot, null, null, 1, 20).total()).isZero();
        task.organizationId = "foreign";
        assertThatThrownBy(() -> policy.check(dispatch(Set.of(), Set.of(device.id)), task.id))
                .isInstanceOf(ApiException.class);
        assertThat(policy.candidates(dispatch(Set.of(), Set.of(device.id)), null, null, 1, 20).total()).isZero();
    }

    @Test
    void candidateListIncludesUnfinishedIneligibleTasksAndFiltersByResourceOrSourceId() {
        task.status = "DRAFT";
        assertThat(policy.candidates(admin(), "巡检", device.sourceDeviceId, 1, 1).items())
                .singleElement().satisfies(check -> assertThat(check.eligible()).isFalse());
        assertThat(policy.candidates(admin(), null, device.id, 1, 20).total()).isOne();
        assertThat(policy.candidates(admin(), "不存在", null, 1, 20).total()).isZero();
        task.deviceId = null;
        assertThat(policy.candidates(admin(), null, device.sourceDeviceId, 1, 20).total()).isZero();
        task.status = "COMPLETED";
        assertThat(policy.candidates(admin(), null, null, 1, 20).total()).isZero();
    }

    @Test
    void callerDeviceGrantRevocationMakesTheEntryIneligibleAndHidesDeviceDetails() {
        CurrentUser caller = dispatch(Set.of("杭州"), Set.of());
        FlightEntryPolicy.EntryCheck result = policy.check(caller, task.id);
        assertThat(result.eligible()).isFalse();
        assertThat(result.checks()).anyMatch(check -> "DEVICE_SCOPE".equals(check.code()) && !check.passed());
        assertThat(result.context().get("device")).isEqualTo(java.util.Map.of());
        assertThat(result.context().get("sourceDeviceId")).isNull();
    }

    @Test
    void bothLocalAndSourceDeviceIdentifiersCanAuthorizeThePilotAndCaller() {
        pilot.deviceIds = device.id;
        assertThat(policy.check(pilot.current(), task.id).eligible()).isTrue();
        assertThat(policy.check(dispatch(Set.of("杭州"), Set.of(device.id)), task.id).eligible()).isTrue();
        assertThat(policy.check(dispatch(Set.of("杭州"), Set.of(device.sourceDeviceId)), task.id).eligible()).isTrue();
    }

    @Test
    void expiredTasksAreOptionalHistoryAndUsableTasksRankBeforePaging() {
        Task expired = candidate("expired", "PENDING_EXECUTION", clock.instant().minusSeconds(600), clock.instant());
        Task blocked = candidate("needs-assignment", "PENDING_ASSIGNMENT", clock.instant().minusSeconds(300), clock.instant().plusSeconds(600));
        Task future = candidate("future", "PENDING_EXECUTION", clock.instant().plusSeconds(300), clock.instant().plusSeconds(600));
        taskRows.addAll(List.of(expired, blocked, future));

        var first = policy.candidates(admin(), null, null, 1, 1);
        assertThat(first.total()).isEqualTo(3);
        assertThat(first.items()).extracting(FlightEntryPolicy.EntryCheck::taskId).containsExactly(task.id);
        var history = policy.candidates(admin(), null, null, 1, 20, true);
        assertThat(history.total()).isEqualTo(4);
        assertThat(history.items().getLast().taskId()).isEqualTo(expired.id);
        assertThat(policy.check(admin(), expired.id).eligible()).isFalse();
    }

    private Task candidate(String id, String status, Instant start, Instant end) {
        Task result = new Task(); result.id = id; result.title = id; result.status = status;
        result.organizationId = task.organizationId; result.region = task.region;
        result.planId = task.planId; result.deviceId = task.deviceId; result.pilotId = task.pilotId;
        result.startAt = start; result.endAt = end;
        return result;
    }

    @Test
    void eachNewCheckReloadsAssignmentVersionsAndPilotPermissions() {
        FlightEntryPolicy.Snapshot before = policy.requireAllowed(admin(), task.id);
        task.status = "EXECUTING";
        task.version++;
        plan.version++;
        device.version++;
        pilot.regions = "杭州,宁波";
        FlightEntryPolicy.Snapshot after = policy.requireAllowed(admin(), task.id);
        assertThat(after.taskVersion()).isEqualTo(before.taskVersion() + 1);
        assertThat(after.planVersion()).isEqualTo(before.planVersion() + 1);
        assertThat(after.resourceVersion()).isEqualTo(before.resourceVersion() + 1);
        assertThat(after.pilotPermissionsFingerprint()).isNotEqualTo(before.pilotPermissionsFingerprint());
        pilot.deviceIds = "";
        assertThatThrownBy(() -> policy.requireAllowed(admin(), task.id)).isInstanceOf(ApiException.class);
    }

    @Test
    void reorderedEquivalentPilotGrantsDoNotChangeTheFingerprint() {
        pilot.regions = "杭州,宁波";
        pilot.deviceIds = "source-device,another";
        FlightEntryPolicy.Snapshot before = policy.requireAllowed(admin(), task.id);
        pilot.regions = "宁波,杭州";
        pilot.deviceIds = "another,source-device";
        assertThat(policy.requireAllowed(admin(), task.id).pilotPermissionsFingerprint())
                .isEqualTo(before.pilotPermissionsFingerprint());
    }

    static class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-21T08:00:00Z");
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
