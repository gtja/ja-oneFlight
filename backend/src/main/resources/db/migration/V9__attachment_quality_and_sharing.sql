ALTER TABLE attachment ADD COLUMN quality_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW';
ALTER TABLE attachment ADD COLUMN quality_note VARCHAR(2000);
ALTER TABLE attachment ADD COLUMN reviewed_by VARCHAR(36);
ALTER TABLE attachment ADD COLUMN reviewed_at TIMESTAMP(6);
ALTER TABLE attachment ADD COLUMN archived_by VARCHAR(36);
ALTER TABLE attachment ADD COLUMN archived_at TIMESTAMP(6);

CREATE TABLE attachment_share_request (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    version BIGINT NOT NULL DEFAULT 0,
    title VARCHAR(180) NOT NULL,
    status VARCHAR(40) NOT NULL,
    organization_id VARCHAR(36) NOT NULL,
    region VARCHAR(80),
    created_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    created_by VARCHAR(36),
    provenance TEXT,
    target_organization_id VARCHAR(36) NOT NULL,
    purpose VARCHAR(2000) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    decision_by VARCHAR(36),
    decision_at TIMESTAMP(6),
    decision_note VARCHAR(2000)
);

CREATE TABLE attachment_share_request_item (
    share_request_id VARCHAR(36) NOT NULL,
    attachment_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (share_request_id, attachment_id),
    CONSTRAINT fk_attachment_share_item_request
        FOREIGN KEY (share_request_id) REFERENCES attachment_share_request (id),
    CONSTRAINT fk_attachment_share_item_attachment
        FOREIGN KEY (attachment_id) REFERENCES attachment (id)
);

CREATE INDEX ix_attachment_quality_archive ON attachment (quality_status, archived_at, created_at);
CREATE INDEX ix_attachment_share_expiry ON attachment_share_request (status, target_organization_id, expires_at);
