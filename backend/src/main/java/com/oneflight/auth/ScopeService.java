package com.oneflight.auth;

import com.oneflight.common.ApiException;
import com.oneflight.domain.*;
import com.oneflight.repository.*;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.*;

@Service
public class ScopeService implements AccessScope {
    private static final String CURRENT_USER_ATTRIBUTE = ScopeService.class.getName() + ".currentUser";
    private final UserAccountRepository users;
    private final ResourceRepository resources;
    private final TaskRepository tasks;

    public ScopeService(
            UserAccountRepository users, ResourceRepository resources, TaskRepository tasks) {
        this.users = users;
        this.resources = resources;
        this.tasks = tasks;
    }

    public CurrentUser currentUser() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getName()))
            throw new ApiException(
                    org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", "请先登录");
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        if (request != null
                && request.getAttribute(CURRENT_USER_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST)
                        instanceof CurrentUser cached
                && Objects.equals(cached.username(), auth.getName())) {
            return cached;
        }
        var u =
                users.findByUsername(auth.getName())
                        .filter(x -> x.enabled)
                        .orElseThrow(ApiException::forbidden);
        CurrentUser current = u.current();
        // A fresh database check occurs on every HTTP request, including account disable/grant changes.
        if (request != null) request.setAttribute(CURRENT_USER_ATTRIBUTE, current, RequestAttributes.SCOPE_REQUEST);
        return current;
    }

    public boolean canAccess(String org, String region) {
        var u = currentUser();
        return u.role() == Role.ADMIN
                || ((Objects.equals(u.organizationId(), org)
                                || (u.role() == Role.DISPATCH
                                        && org != null
                                        && u.organizationIds().contains(org)))
                        && (u.regions().isEmpty()
                                || region == null
                                || u.regions().contains(region)));
    }

    public boolean canRead(BaseRecord record) {
        if (!canAccess(record.organizationId, record.region)) return false;
        CurrentUser user = currentUser();
        if (record instanceof Resource resource
                && "DEVICE".equals(resource.kind)
                && user.role() != Role.ADMIN) {
            return user.deviceIds().contains(resource.id)
                    || (resource.sourceDeviceId != null
                            && user.deviceIds().contains(resource.sourceDeviceId));
        }
        if (user.role() != Role.PILOT) return true;
        if (record instanceof Task task) return Objects.equals(task.pilotId, user.id());
        if (record instanceof FlightPlan plan)
            return Objects.equals(plan.createdBy, user.id())
                    || assignedPlanTask(plan, user.id())
                    || tasks.findByPlanIdAndPilotId(plan.id, user.id()).stream()
                            .anyMatch(task ->
                                    Objects.equals(task.organizationId, plan.organizationId)
                                            && canAccess(task.organizationId, task.region));
        if (record instanceof IndustryCase industryCase)
            return Objects.equals(industryCase.createdBy, user.id())
                    || assignedTask(industryCase.taskId, user.id());
        if (record instanceof Consultation) return Objects.equals(record.createdBy, user.id());
        return true;
    }

    private boolean assignedTask(String taskId, String pilotId) {
        return taskId != null
                && tasks.findById(taskId)
                        .filter(
                                task ->
                                        Objects.equals(task.pilotId, pilotId)
                                                && canAccess(task.organizationId, task.region))
                        .isPresent();
    }

    private boolean assignedPlanTask(FlightPlan plan, String pilotId) {
        return plan.taskId != null && tasks.findById(plan.taskId).filter(task ->
                Objects.equals(task.pilotId, pilotId)
                        && Objects.equals(task.organizationId, plan.organizationId)
                        && Objects.equals(task.region, plan.region)
                        && (task.planId == null || Objects.equals(task.planId, plan.id))
                        && canAccess(task.organizationId, task.region)).isPresent();
    }

    public void requireAccess(BaseRecord record) {
        if (!canRead(record)) throw ApiException.forbidden();
    }

    public void requireRole(Role... roles) {
        Role current = currentUser().role();
        if (Arrays.stream(roles).noneMatch(x -> x == current)) throw ApiException.forbidden();
    }

    public Set<String> allowedDeviceIds() {
        var u = currentUser();
        Set<String> result = new HashSet<>();
        for (Resource d : resources.findAll()) {
            if (!"DEVICE".equals(d.kind)
                    || d.sourceDeviceId == null
                    || !canAccess(d.organizationId, d.region)) continue;
            if (u.role() == Role.ADMIN
                    || u.deviceIds().contains(d.sourceDeviceId)
                    || u.deviceIds().contains(d.id)) result.add(d.sourceDeviceId);
        }
        return Set.copyOf(result);
    }

    public void requireDevice(String id) {
        if (!allowedDeviceIds().contains(id)) throw ApiException.forbidden();
    }

    public void requireResource(Resource resource) {
        requireAccess(resource);
        var u = currentUser();
        if ("DEVICE".equals(resource.kind)
                && u.role() != Role.ADMIN
                && !u.deviceIds().contains(resource.id)
                && (resource.sourceDeviceId == null
                        || !u.deviceIds().contains(resource.sourceDeviceId)))
            throw ApiException.forbidden();
    }
}
