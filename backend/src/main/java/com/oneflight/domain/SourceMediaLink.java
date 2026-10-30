package com.oneflight.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Entity
@Table(
        name = "source_media_link",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uk_source_media_identity",
                        columnNames = {"source_system", "source_device_id", "source_media_id"}),
        indexes = {
            @Index(name = "ix_source_media_task", columnList = "task_id"),
            @Index(name = "ix_source_media_case", columnList = "case_id")
        })
public class SourceMediaLink extends BaseRecord {
    @Column(name = "source_system", nullable = false, length = 40)
    public String sourceSystem;

    @Column(name = "source_media_id", nullable = false, length = 180)
    public String sourceMediaId;

    @Column(name = "source_device_id", nullable = false, length = 180)
    public String sourceDeviceId;

    @Column(name = "source_action_id", length = 180)
    public String sourceActionId;

    @Column(name = "source_action_item_id", length = 180)
    public String sourceActionItemId;

    @Column(name = "source_record_id", length = 80)
    public String sourceRecordId;

    @Column(name = "source_bid", length = 180)
    public String sourceBid;

    @Column(name = "source_name", columnDefinition = "TEXT")
    public String sourceName;

    @Column(name = "source_media_type", length = 80)
    public String sourceMediaType;

    @Column(name = "photo_type", length = 80)
    public String photoType;

    @Column(name = "source_path", nullable = false, columnDefinition = "TEXT")
    public String sourcePath;

    @Column(name = "captured_from")
    public Instant capturedFrom;

    @Column(name = "captured_to")
    public Instant capturedTo;

    public Double longitude;
    public Double latitude;
    public Double sourceHeight;

    @Column(name = "task_id", length = 36)
    public String taskId;

    @Column(name = "case_id", length = 36)
    public String caseId;

    @Column(name = "linked_by", length = 36)
    public String linkedBy;

    @Column(name = "linked_at")
    public Instant linkedAt;

    @Override
    public Map<String, Object> view() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("id", sourceMediaId);
        fields.put("sourceSystem", sourceSystem);
        fields.put("sourceMediaId", sourceMediaId);
        fields.put("sourceDeviceId", sourceDeviceId);
        fields.put("sourceActionId", sourceActionId);
        fields.put("sourceActionItemId", sourceActionItemId);
        fields.put("sourceId", sourceRecordId);
        fields.put("sourceBid", sourceBid);
        fields.put("sourceName", sourceName);
        fields.put("sourceMediaType", sourceMediaType);
        fields.put("photoType", photoType);
        fields.put("capturedFrom", capturedFrom);
        fields.put("capturedTo", capturedTo);
        fields.put("longitude", longitude);
        fields.put("latitude", latitude);
        fields.put("sourceHeight", sourceHeight);
        fields.put("taskId", taskId);
        fields.put("caseId", caseId);
        fields.put("linkedAt", linkedAt);
        return fields;
    }
}
