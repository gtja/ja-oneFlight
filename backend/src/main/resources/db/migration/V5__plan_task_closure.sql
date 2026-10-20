-- A plan authorizes multiple concrete tasks. Retried arrangement requests create one task only.
ALTER TABLE flight_task ADD COLUMN plan_creation_request_id VARCHAR(36);
ALTER TABLE flight_task ADD COLUMN plan_creation_plan_id VARCHAR(36);
ALTER TABLE flight_task ADD COLUMN plan_creation_request_hash VARCHAR(64);
CREATE UNIQUE INDEX uq_task_plan_request ON flight_task (plan_creation_plan_id, plan_creation_request_id);
CREATE INDEX ix_task_plan ON flight_task (plan_id);
