package com.oneflight.service;

import com.oneflight.common.ApiException;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.Task;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/** One compatibility rule for plan creation, task linking and execution. */
@Component
public class FlightPlanTaskPolicy {
    public boolean isFlightPlan(FlightPlan plan) {
        return "DAILY".equals(plan.kind) || "LONG_TERM".equals(plan.kind);
    }

    public void requireCompatible(Task task, FlightPlan plan) {
        if (!isFlightPlan(plan)) throw ApiException.invalid("只能关联日常或长期飞行计划");
        if (plan.status == null || !Set.of("DRAFT", "PENDING_REVIEW", "RETURNED", "APPROVED").contains(plan.status))
            throw ApiException.invalid("该计划当前状态不可关联");
        if (!Objects.equals(task.organizationId, plan.organizationId))
            throw ApiException.invalid("计划与任务须属于同一组织");
        if (!Objects.equals(task.region, plan.region))
            throw ApiException.invalid("任务区域必须与飞行计划适用区域一致");
        if (task.startAt == null || task.endAt == null || !task.endAt.isAfter(task.startAt))
            throw ApiException.invalid("任务起止时间不完整或结束时间不晚于开始时间");
        if (plan.startAt == null || plan.endAt == null || !plan.endAt.isAfter(plan.startAt))
            throw ApiException.invalid("飞行计划起止时间不完整，请先完善计划");
        if (task.startAt.isBefore(plan.startAt) || task.endAt.isAfter(plan.endAt))
            throw ApiException.invalid("任务时间必须在关联飞行计划的起止时间内");
    }

    public void requireApproved(FlightPlan plan) {
        if (!"APPROVED".equals(plan.status))
            throw new ApiException(HttpStatus.CONFLICT, "PLAN_APPROVAL_REQUIRED", "关联飞行计划尚未审批通过，请先完成计划审批");
    }
}
