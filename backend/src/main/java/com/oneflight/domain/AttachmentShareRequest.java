package com.oneflight.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "attachment_share_request")
public class AttachmentShareRequest extends BaseRecord {
    @Column(name = "target_organization_id", nullable = false, length = 36)
    public String targetOrganizationId;

    @Column(name = "purpose", nullable = false, length = 2000)
    public String purpose;

    @Column(name = "expires_at", nullable = false)
    public Instant expiresAt;

    @Column(name = "decision_by", length = 36)
    public String decisionBy;

    @Column(name = "decision_at")
    public Instant decisionAt;

    @Column(name = "decision_note", length = 2000)
    public String decisionNote;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(
            name = "attachment_share_request_item",
            joinColumns = @JoinColumn(name = "share_request_id"))
    @Column(name = "attachment_id", nullable = false, length = 36)
    public Set<String> attachmentIds = new LinkedHashSet<>();

    @Override
    public Map<String, Object> view() {
        Map<String, Object> fields = super.view();
        fields.put("targetOrganizationId", targetOrganizationId);
        fields.put("purpose", purpose);
        fields.put("expiresAt", expiresAt);
        fields.put("decisionBy", decisionBy);
        fields.put("decisionAt", decisionAt);
        fields.put("decisionNote", decisionNote);
        fields.put("attachmentIds", attachmentIds.stream().sorted().toList());
        fields.put("attachmentCount", attachmentIds.size());
        return fields;
    }
}
