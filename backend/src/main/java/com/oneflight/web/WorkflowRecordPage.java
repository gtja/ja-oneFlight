package com.oneflight.web;

import com.oneflight.common.PageResult;
import com.oneflight.domain.BaseRecord;
import com.oneflight.domain.Consultation;
import com.oneflight.domain.FlightPlan;
import com.oneflight.domain.IndustryCase;
import com.oneflight.domain.Resource;
import com.oneflight.domain.Task;
import com.oneflight.service.WorkflowService;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/** Shared list filtering preserves visibility, search fields, ordering and paging for workflow APIs. */
@Component
public class WorkflowRecordPage {
    private final WorkflowService service;

    public WorkflowRecordPage(WorkflowService service) {
        this.service = service;
    }

    PageResult<Map<String, Object>> page(
            List<? extends BaseRecord> all,
            int page,
            int pageSize,
            String query,
            String status,
            String kind,
            String scene) {
        String keyword = query == null || query.isBlank() ? null : query.trim().toLowerCase(Locale.ROOT);
        boolean filterStatus = status != null && !status.isBlank();
        boolean filterKind = kind != null && !kind.isBlank();
        boolean filterScene = scene != null && !scene.isBlank();
        return PageResult.of(
                all.stream()
                        .filter(service::visible)
                        .filter(record -> !filterStatus || status.equals(record.status))
                        .filter(record -> matches(record, keyword))
                        .filter(
                                record ->
                                        !filterKind
                                                || (record instanceof Resource resource
                                                        && kind.equals(resource.kind))
                                                || (record instanceof FlightPlan plan
                                                        && kind.equals(plan.kind))
                                                || (record instanceof Consultation consultation
                                                        && kind.equals(consultation.kind)))
                        .filter(
                                record ->
                                        !filterScene
                                                || (record instanceof Task task
                                                        && scene.equals(task.scene))
                                                || (record instanceof IndustryCase industryCase
                                                        && scene.equals(industryCase.scene)))
                        .sorted(Comparator.comparing((BaseRecord record) -> record.createdAt).reversed())
                        .map(BaseRecord::view)
                        .toList(),
                page,
                pageSize);
    }

    private boolean matches(BaseRecord record, String keyword) {
        if (keyword == null) return true;
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
        return fields.stream()
                .filter(Objects::nonNull)
                .anyMatch(field -> field.toLowerCase(Locale.ROOT).contains(keyword));
    }
}
