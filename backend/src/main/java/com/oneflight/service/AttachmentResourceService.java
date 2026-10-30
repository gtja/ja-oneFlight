package com.oneflight.service;

import com.oneflight.auth.Role;
import com.oneflight.auth.ScopeService;
import com.oneflight.common.ApiException;
import com.oneflight.common.PageResult;
import com.oneflight.domain.Attachment;
import com.oneflight.domain.AttachmentShareRequest;
import com.oneflight.domain.Organization;
import com.oneflight.repository.AttachmentRepository;
import com.oneflight.repository.AttachmentShareRequestRepository;
import com.oneflight.repository.OrganizationRepository;
import com.oneflight.web.Requests.AttachmentShareDecisionInput;
import com.oneflight.web.Requests.AttachmentShareRequestInput;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Service
@Transactional
public class AttachmentResourceService {
    private static final Duration MAX_SHARE_DURATION = Duration.ofDays(90);

    private final AttachmentRepository attachments;
    private final AttachmentShareRequestRepository requests;
    private final OrganizationRepository organizations;
    private final WorkflowService workflow;
    private final ScopeService scope;
    private final AuditService audit;

    public AttachmentResourceService(
            AttachmentRepository attachments,
            AttachmentShareRequestRepository requests,
            OrganizationRepository organizations,
            WorkflowService workflow,
            ScopeService scope,
            AuditService audit) {
        this.attachments = attachments;
        this.requests = requests;
        this.organizations = organizations;
        this.workflow = workflow;
        this.scope = scope;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<AttachmentShareRequest> activeGrantsForCurrentUser() {
        var user = scope.currentUser();
        Instant now = Instant.now();
        return requests.findByStatusAndExpiresAtAfter("APPROVED", now).stream()
                .filter(request -> scope.canAccess(user, request.targetOrganizationId, request.region))
                .toList();
    }

    @Transactional(readOnly = true)
    public PageResult<Map<String, Object>> listRequests(int page, int pageSize) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        var user = scope.currentUser();
        List<Map<String, Object>> visible = requests.findAll().stream()
                .filter(request -> Objects.equals(request.createdBy, user.id())
                        || scope.canAccess(user, request.organizationId, request.region))
                .sorted(Comparator.comparing((AttachmentShareRequest request) -> request.createdAt).reversed())
                .map(this::shareRequestView)
                .toList();
        return PageResult.of(visible, page, pageSize);
    }

    public Map<String, Object> requestShare(AttachmentShareRequestInput input) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        Instant now = Instant.now();
        if (input.expiresAt() == null
                || !input.expiresAt().isAfter(now.plus(Duration.ofHours(1)))
                || input.expiresAt().isAfter(now.plus(MAX_SHARE_DURATION)))
            throw ApiException.invalid("共享期限须在1小时后至90天内");
        Organization target = organizations.findById(input.targetOrganizationId())
                .filter(organization -> "ACTIVE".equals(organization.status))
                .orElseThrow(() -> ApiException.invalid("共享目标组织不存在或未启用"));
        List<String> attachmentIds = input.attachmentIds().stream().distinct().sorted().toList();
        List<Attachment> selected = attachments.findAllById(attachmentIds);
        if (selected.size() != attachmentIds.size()) throw ApiException.missing();

        Attachment first = selected.get(0);
        requireDirectAccess(first);
        if (Objects.equals(first.organizationId, target.id))
            throw ApiException.invalid("共享目标不能是成果所属组织");
        for (Attachment item : selected) {
            requireDirectAccess(item);
            if (!Objects.equals(first.organizationId, item.organizationId)
                    || !Objects.equals(first.region, item.region))
                throw ApiException.invalid("一次共享申请只能包含同一组织和区域的成果");
        }

        AttachmentShareRequest request = new AttachmentShareRequest();
        request.title = "数据成果共享申请";
        request.status = "PENDING";
        request.organizationId = first.organizationId;
        request.region = first.region;
        request.createdBy = scope.currentUser().id();
        request.targetOrganizationId = target.id;
        request.purpose = input.purpose().trim();
        request.expiresAt = input.expiresAt();
        request.attachmentIds = new LinkedHashSet<>(attachmentIds);
        request.createdAt = now;
        request.updatedAt = now;
        AttachmentShareRequest saved = requests.saveAndFlush(request);
        audit.record("ATTACHMENT_SHARE", saved, "REQUEST", request.purpose);
        return shareRequestView(saved);
    }

    public Map<String, Object> decide(
            String id, AttachmentShareDecisionInput input) {
        scope.requireRole(Role.ADMIN, Role.DISPATCH);
        AttachmentShareRequest request = requests.findById(id).orElseThrow(ApiException::missing);
        scope.requireAccess(request);
        var user = scope.currentUser();
        if (Objects.equals(request.createdBy, user.id()))
            throw ApiException.invalid("申请人不能审批自己的共享申请");
        if (!"PENDING".equals(request.status))
            throw ApiException.invalid("共享申请已处理");
        if (!request.expiresAt.isAfter(Instant.now()))
            throw ApiException.invalid("共享申请已过期");
        if ("REJECT".equals(input.action())
                && (input.note() == null || input.note().isBlank()))
            throw ApiException.invalid("驳回时请填写原因");

        request.status = "APPROVE".equals(input.action()) ? "APPROVED" : "REJECTED";
        request.decisionBy = user.id();
        request.decisionAt = Instant.now();
        request.decisionNote = input.note() == null ? null : input.note().trim();
        AttachmentShareRequest saved = requests.saveAndFlush(request);
        audit.record(
                "ATTACHMENT_SHARE",
                saved,
                request.status,
                request.decisionNote == null ? request.purpose : request.decisionNote);
        return shareRequestView(saved);
    }

    public Map<String, AttachmentShareRequest> activeGrantsByAttachment() {
        Map<String, AttachmentShareRequest> grants = new HashMap<>();
        for (AttachmentShareRequest request : activeGrantsForCurrentUser()) {
            for (String attachmentId : request.attachmentIds) {
                grants.putIfAbsent(attachmentId, request);
            }
        }
        return grants;
    }

    public boolean canReadShared(Attachment attachment) {
        return activeGrantsByAttachment().containsKey(attachment.id);
    }

    public void requireDirectAccess(Attachment attachment) {
        if ("TASK".equals(attachment.entityType)) {
            workflow.get(workflow.tasks(), attachment.entityId);
            return;
        }
        if ("CASE".equals(attachment.entityType)) {
            workflow.get(workflow.cases(), attachment.entityId);
            return;
        }
        throw ApiException.invalid("附件关联的业务记录类型无效");
    }

    private Map<String, Object> shareRequestView(AttachmentShareRequest request) {
        Map<String, Object> view = request.view();
        view.put("sourceOrganizationName", organizationTitle(request.organizationId));
        view.put("targetOrganizationName", organizationTitle(request.targetOrganizationId));
        return view;
    }

    private String organizationTitle(String id) {
        return organizations.findById(id).map(organization -> organization.title).orElse("组织已移除");
    }
}
