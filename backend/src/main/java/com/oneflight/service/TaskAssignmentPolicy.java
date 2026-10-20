package com.oneflight.service;

import com.oneflight.auth.Role;
import com.oneflight.common.ApiException;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.domain.UserAccount;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/** The same business rules drive assignment choices and the final, locked assignment check. */
@Component
public class TaskAssignmentPolicy {
    public record Reason(String code, String message) {}

    public List<Reason> taskReasons(Task task) {
        List<Reason> reasons = new ArrayList<>();
        if (!"PENDING_ASSIGNMENT".equals(task.status))
            reasons.add(new Reason("TASK_STATE", "任务当前不是待分配状态"));
        if (!hasValidInterval(task))
            reasons.add(new Reason("TASK_TIME", "任务起止时间不完整或结束时间不晚于开始时间"));
        return List.copyOf(reasons);
    }

    public List<Reason> deviceReasons(Task task, Resource device, List<Task> overlaps) {
        List<Reason> reasons = new ArrayList<>(taskReasons(task));
        if (!"DEVICE".equals(device.kind))
            reasons.add(new Reason("DEVICE_TYPE", "所选资源不是执行设备"));
        if (!"ACTIVE".equals(device.status)) {
            if ("PENDING_CONFIRMATION".equals(device.status))
                reasons.add(new Reason("DEVICE_PENDING_CONFIRMATION", "设备调度资料待确认，请先到资源管理完善并启用"));
            else reasons.add(new Reason("DEVICE_STATUS", "设备当前未启用，不能分配"));
        }
        if (!Objects.equals(device.organizationId, task.organizationId))
            reasons.add(new Reason("DEVICE_ORGANIZATION", "设备与任务不属于同一组织"));
        if (overlaps.stream().anyMatch(other -> Objects.equals(other.deviceId, device.id)))
            reasons.add(new Reason("DEVICE_CONFLICT", "设备在任务时段已被其他任务占用"));
        return List.copyOf(reasons);
    }

    public List<Reason> pilotReasons(
            Task task, UserAccount pilot, Resource device, List<Task> overlaps) {
        List<Reason> reasons = new ArrayList<>(taskReasons(task));
        if (pilot.role != Role.PILOT)
            reasons.add(new Reason("PILOT_ROLE", "所选账号不是执行飞手"));
        if (!pilot.enabled)
            reasons.add(new Reason("PILOT_DISABLED", "飞手账号已停用"));
        if (!Objects.equals(pilot.organizationId, task.organizationId))
            reasons.add(new Reason("PILOT_ORGANIZATION", "飞手与任务不属于同一组织"));
        var regions = UserAccount.split(pilot.regions);
        if (!regions.isEmpty() && !regions.contains(task.region))
            reasons.add(new Reason("PILOT_REGION", "飞手仅授权区域“" + String.join("、", regions)
                    + "”，未获任务区域“" + task.region + "”的执行权限"));
        if (device != null) {
            var allowedDevices = UserAccount.split(pilot.deviceIds);
            if (!allowedDevices.contains(device.id)
                    && (device.sourceDeviceId == null || !allowedDevices.contains(device.sourceDeviceId)))
                reasons.add(new Reason("PILOT_DEVICE", "飞手未授权使用所选设备"));
        }
        if (overlaps.stream().anyMatch(other -> Objects.equals(other.pilotId, pilot.id)))
            reasons.add(new Reason("PILOT_CONFLICT", "飞手在任务时段已被其他任务占用"));
        return List.copyOf(reasons);
    }

    public void requireAssignable(
            Task task, Resource device, UserAccount pilot, List<Task> overlaps) {
        List<Reason> reasons = new ArrayList<>(deviceReasons(task, device, overlaps));
        reasons.addAll(pilotReasons(task, pilot, device, overlaps));
        if (!reasons.isEmpty()) {
            Reason reason = reasons.getFirst();
            if ("TASK_STATE".equals(reason.code()))
                throw new ApiException(HttpStatus.CONFLICT, "INVALID_TRANSITION", reason.message());
            if (reason.code().endsWith("_CONFLICT"))
                throw new ApiException(HttpStatus.CONFLICT, "RESOURCE_CONFLICT", reason.message());
            throw ApiException.invalid(reason.message());
        }
    }

    public boolean hasValidInterval(Task task) {
        return task.startAt != null && task.endAt != null && task.endAt.isAfter(task.startAt);
    }
}
