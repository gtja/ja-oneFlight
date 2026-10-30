ALTER TABLE attachment ADD COLUMN case_id VARCHAR(36) NULL;

CREATE INDEX ix_attachment_case_id ON attachment (case_id);

ALTER TABLE attachment
    ADD CONSTRAINT fk_attachment_case_id
    FOREIGN KEY (case_id) REFERENCES industry_case (id);
