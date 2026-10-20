-- OneFlight local business store. Upstream schemas are accessed read-only.
CREATE TABLE organization (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  version BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(40) NOT NULL,
  region VARCHAR(80),
  organization_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  created_by VARCHAR(36),
  parent_id VARCHAR(180),
  contact VARCHAR(180)
);

CREATE TABLE flight_task (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  version BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(40) NOT NULL,
  region VARCHAR(80),
  organization_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  created_by VARCHAR(36),
  description TEXT,
  scene VARCHAR(180),
  priority VARCHAR(180),
  start_at TIMESTAMP(6),
  end_at TIMESTAMP(6),
  device_id VARCHAR(180),
  pilot_id VARCHAR(180),
  plan_id VARCHAR(180),
  result_summary TEXT
);

CREATE TABLE flight_plan (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  version BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(40) NOT NULL,
  region VARCHAR(80),
  organization_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  created_by VARCHAR(36),
  kind VARCHAR(180),
  start_at TIMESTAMP(6),
  end_at TIMESTAMP(6),
  height DOUBLE,
  scope TEXT,
  resource_id VARCHAR(180),
  task_id VARCHAR(180),
  receipt_number VARCHAR(180),
  receipt_basis TEXT,
  material_name VARCHAR(180),
  material_number VARCHAR(180),
  valid_from DATE,
  valid_until DATE
);

CREATE TABLE platform_resource (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  version BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(40) NOT NULL,
  region VARCHAR(80),
  organization_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  created_by VARCHAR(36),
  kind VARCHAR(180),
  model VARCHAR(180),
  source_device_id VARCHAR(180),
  product_key VARCHAR(180),
  sn VARCHAR(180),
  longitude DOUBLE,
  latitude DOUBLE,
  metadata TEXT
);

CREATE TABLE industry_case (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  version BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(40) NOT NULL,
  region VARCHAR(80),
  organization_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  created_by VARCHAR(36),
  scene VARCHAR(180),
  description TEXT,
  task_id VARCHAR(180),
  conclusion TEXT
);

CREATE TABLE consultation (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  version BIGINT NOT NULL,
  title VARCHAR(180) NOT NULL,
  status VARCHAR(40) NOT NULL,
  region VARCHAR(80),
  organization_id VARCHAR(36) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL,
  created_by VARCHAR(36),
  kind VARCHAR(180),
  description TEXT,
  answer TEXT
);

CREATE TABLE user_account (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  role VARCHAR(24) NOT NULL,
  organization_id VARCHAR(36) NOT NULL,
  regions TEXT,
  device_ids TEXT,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMP(6)
);

CREATE TABLE audit_event (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  actor_id VARCHAR(36) NOT NULL,
  actor_name VARCHAR(100),
  action VARCHAR(80) NOT NULL,
  organization_id VARCHAR(36),
  region VARCHAR(80),
  entity_type VARCHAR(80),
  entity_id VARCHAR(36),
  note VARCHAR(2000),
  created_at TIMESTAMP(6)
);

CREATE TABLE attachment (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  organization_id VARCHAR(36) NOT NULL,
  region VARCHAR(80),
  uploaded_by VARCHAR(36) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(30) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  size BIGINT NOT NULL,
  created_at TIMESTAMP(6)
);

CREATE TABLE platform_setting (
  id VARCHAR(80) NOT NULL PRIMARY KEY,
  setting_value TEXT,
  updated_at TIMESTAMP(6)
);

CREATE INDEX ix_flight_task_scope ON flight_task (organization_id, region, status);
CREATE INDEX ix_flight_plan_scope ON flight_plan (organization_id, region, status);
CREATE INDEX ix_platform_resource_scope ON platform_resource (organization_id, region, status);
CREATE INDEX ix_industry_case_scope ON industry_case (organization_id, region, status);
CREATE INDEX ix_consultation_scope ON consultation (organization_id, region, status);
CREATE INDEX ix_task_schedule ON flight_task (device_id, start_at, end_at);
CREATE INDEX ix_audit_entity ON audit_event (entity_type, entity_id, created_at);
CREATE INDEX ix_attachment_entity ON attachment (entity_type, entity_id);
