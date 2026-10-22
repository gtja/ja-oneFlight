package com.oneflight.auth;

import com.oneflight.common.ApiException;
import com.oneflight.domain.*;
import com.oneflight.repository.*;

import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.*;

@Service
public class ScopeService implements AccessScope {
    private static final String CURRENT_USER_ATTRIBUTE = ScopeService.class.getName() + ".currentUser";
    private static final String PRINCIPAL_ATTRIBUTE = ScopeService.class.getName() + ".principal";
    private final UserAccountRepository users;
    private final ResourceRepository resources;
    private final TaskRepository tasks;
    private final FourAIdentityService identities;

    @Autowired
    public ScopeService(
            UserAccountRepository users, ResourceRepository resources, TaskRepository tasks,
            FourAIdentityService identities) {
        this.users = users;
        this.resources = resources;
        this.tasks = tasks;
        this.identities = identities;
    }

    public ScopeService(
            UserAccountRepository users, ResourceRepository resources, TaskRepository tasks) {
        this(users, resources, tasks, null);
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
                && Objects.equals(request.getAttribute(PRINCIPAL_ATTRIBUTE,
                        RequestAttributes.SCOPE_REQUEST), auth.getName())) {
            return cached;
        }
        var u =
                users.findByUsername(auth.getName())
                        .filter(x -> x.enabled)
                        .orElseThrow(ApiException::forbidden);
        CurrentUser current = identities == null ? u.current() : identities.currentView(u);
        // A fresh database check occurs on every HTTP request, including account disable/grant changes.
        if (request != null) {
            request.setAttribute(CURRENT_USER_ATTRIBUTE, current, RequestAttributes.SCOPE_REQUEST);
            request.setAttribute(PRINCIPAL_ATTRIBUTE, auth.getName(), RequestAttributes.SCOPE_REQUEST);
        }
        return current;
    }

    public boolean canAccess(String org, String region) {
        return canAccess(currentUser(), org, region);
    }

    /** Explicit identity variant for short-lived launch tickets and gateway requests. */
    public boolean canAccess(CurrentUser u, String org, String region) {
        if (u == null) return false;
        if (!u.businessAccessAssigned()) return false;
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
        return canRead(currentUser(), record);
    }

    public boolean canRead(CurrentUser user, BaseRecord record) {
        if (record == null || !canAccess(user, record.organizationId, record.region)) return false;
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
                    || assignedPlanTask(user, plan, user.id())
                    || tasks.findByPlanIdAndPilotId(plan.id, user.id()).stream()
                            .anyMatch(task ->
                                    Objects.equals(task.organizationId, plan.organizationId)
                                            && canAccess(user, task.organizationId, task.region));
        if (record instanceof IndustryCase industryCase)
            return Objects.equals(industryCase.createdBy, user.id())
                    || assignedTask(user, industryCase.taskId, user.id());
        if (record instanceof Consultation) return Objects.equals(record.createdBy, user.id());
        return true;
    }

    private boolean assignedTask(CurrentUser user, String taskId, String pilotId) {
        return taskId != null
                && tasks.findById(taskId)
                        .filter(
                                task ->
                                        Objects.equals(task.pilotId, pilotId)
                                                && canAccess(user, task.organizationId, task.region))
                        .isPresent();
    }

    private boolean assignedPlanTask(CurrentUser user, FlightPlan plan, String pilotId) {
        return plan.taskId != null && tasks.findById(plan.taskId).filter(task ->
                Objects.equals(task.pilotId, pilotId)
                        && Objects.equals(task.organizationId, plan.organizationId)
                        && Objects.equals(task.region, plan.region)
                        && (task.planId == null || Objects.equals(task.planId, plan.id))
                        && canAccess(user, task.organizationId, task.region)).isPresent();
    }

    public void requireAccess(BaseRecord record) {
        requireAccess(currentUser(), record);
    }

    public void requireAccess(CurrentUser user, BaseRecord record) {
        if (!canRead(user, record)) throw ApiException.forbidden();
    }

    public void requireRole(Role... roles) {
        requireRole(currentUser(), roles);
    }

    public void requireRole(CurrentUser user, Role... roles) {
        if (user == null) throw ApiException.forbidden();
        if (!user.businessAccessAssigned())
            throw new ApiException(org.springframework.http.HttpStatus.FORBIDDEN,
                    "BUSINESS_ACCESS_PENDING", "4A 身份已验证，请联系平台管理员配置业务角色和权限");
        Role current = user.role();
        if (Arrays.stream(roles).noneMatch(x -> x == current)) throw ApiException.forbidden();
    }

    public Set<String> allowedDeviceIds() {
        return allowedDeviceIds(currentUser());
    }

    public Set<String> allowedDeviceIds(CurrentUser u) {
        Set<String> result = new HashSet<>();
        for (Resource d : resources.findAll()) {
            if (!"DEVICE".equals(d.kind)
                    || d.sourceDeviceId == null
                    || !canAccess(u, d.organizationId, d.region)) continue;
            if (u.role() == Role.ADMIN
                    || u.deviceIds().contains(d.sourceDeviceId)
                    || u.deviceIds().contains(d.id)) result.add(d.sourceDeviceId);
        }
        return Set.copyOf(result);
    }

    public void requireDevice(String id) {
        requireDevice(currentUser(), id);
    }

    public void requireDevice(CurrentUser user, String id) {
        if (!allowedDeviceIds(user).contains(id)) throw ApiException.forbidden();
    }

    public void requireResource(Resource resource) {
        requireResource(currentUser(), resource);
    }

    public void requireResource(CurrentUser u, Resource resource) {
        requireAccess(u, resource);
        if ("DEVICE".equals(resource.kind)
                && u.role() != Role.ADMIN
                && !u.deviceIds().contains(resource.id)
                && (resource.sourceDeviceId == null
                        || !u.deviceIds().contains(resource.sourceDeviceId)))
            throw ApiException.forbidden();
    }
}
