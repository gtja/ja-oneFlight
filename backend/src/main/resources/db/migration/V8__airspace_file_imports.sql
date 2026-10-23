-- Local GeoJSON drafts and commits never write upstream data or device fences.
ALTER TABLE platform_resource MODIFY metadata MEDIUMTEXT;

CREATE TABLE airspace_import_batch (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  created_by VARCHAR(36) NOT NULL,
  organization_id VARCHAR(36) NOT NULL,
  region VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL,
  filename VARCHAR(200) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  payload_hash VARCHAR(64) NOT NULL,
  normalized_payload MEDIUMTEXT,
  result_json TEXT,
  created_at TIMESTAMP(6) NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  committed_at TIMESTAMP(6)
);
CREATE INDEX ix_airspace_import_expiry ON airspace_import_batch (status, expires_at);
