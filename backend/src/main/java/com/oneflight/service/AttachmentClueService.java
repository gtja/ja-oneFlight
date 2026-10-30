package com.oneflight.service;

import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.domain.Attachment;
import com.oneflight.domain.IndustryCase;
import com.oneflight.domain.Task;
import com.oneflight.repository.AttachmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Objects;

@Service
public class AttachmentClueService {
    private final AttachmentRepository attachments;
    private final WorkflowService workflow;
    private final ScopeService scope;
    private final AuditService audit;

    public AttachmentClueService(
            AttachmentRepository attachments,
            WorkflowService workflow,
            ScopeService scope,
            AuditService audit) {
        this.attachments = attachments;
        this.workflow = workflow;
        this.scope = scope;
        this.audit = audit;
    }

    @Transactional
    public IndustryCase markAsClue(String attachmentId) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH, Role.DEPARTMENT);
        Attachment attachment = attachments.findByIdForUpdate(attachmentId)
                .orElseThrow(ApiException::missing);
        if (!"TASK".equals(attachment.entityType))
            throw ApiException.invalid("只有任务成果可以形成场景线索");

        Task task = workflow.get(workflow.tasks(), attachment.entityId);
        if (!Objects.equals(task.organizationId, attachment.organizationId)
                || !Objects.equals(task.region, attachment.region))
            throw ApiException.invalid("成果与来源任务的组织或区域不一致，不能形成场景线索");
        if (attachment.caseId != null && !attachment.caseId.isBlank())
            return workflow.get(workflow.cases(), attachment.caseId);

        IndustryCase created = workflow.createCaseFromDataResult(task.id, attachment.filename);
        attachment.caseId = created.id;
        Attachment saved = attachments.saveAndFlush(attachment);
        audit.record("ATTACHMENT", saved.id, saved.organizationId, saved.region,
                "CLUE_LINK", "关联疑似线索 " + created.id);
        return created;
    }
}
